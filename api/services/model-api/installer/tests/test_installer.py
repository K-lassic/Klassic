"""#138 구조에서의 위치: 설치기 검증 — 손상 다운로드·부분 설치·완료 표식 회귀 검사."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('install_state', '/scripts/install_state.py')
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.locks = self.root/'locks'
        (self.locks/'homr').mkdir(parents=True)
        self.patch = patch.object(state, 'LOCKS', self.locks)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def checkpoint(self, symlink=False):
        folder = self.root/'jeongganbo'
        (folder/'repo').mkdir(parents=True)
        archive = folder/'checkpoints.tar.gz'
        data = b'fixed checkpoint'
        name = 'checkpoints/best/model.pt'
        with tarfile.open(archive, 'w:gz') as tar:
            member = tarfile.TarInfo(name)
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = '/tmp/outside'
                tar.addfile(member)
            else:
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
            extra = tarfile.TarInfo('../../outside')
            extra.size = 3
            tar.addfile(extra, io.BytesIO(b'bad'))
        source = {'jeongganbo': {'checkpoint_sha256': state.digest(archive), 'files': {
            name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}}}}
        (self.locks/'sources.json').write_text(json.dumps(source))
        return archive, folder/'repo'/name

    def test_bad_archive_hash_is_rejected_before_write(self):
        archive, output = self.checkpoint()
        archive.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            state.extract_checkpoint(self.root)
        self.assertFalse(output.exists())

    def test_only_expected_regular_files_are_extracted(self):
        archive, output = self.checkpoint()
        state.extract_checkpoint(self.root)
        self.assertEqual(output.read_bytes(), b'fixed checkpoint')
        self.assertFalse(archive.exists())
        self.assertFalse((self.root/'outside').exists())

    def test_archive_symlink_is_rejected(self):
        _, output = self.checkpoint(symlink=True)
        with self.assertRaisesRegex(ValueError, '일반'):
            state.extract_checkpoint(self.root)
        self.assertFalse(output.exists())

    def test_partial_venv_is_not_accepted_or_overwritten(self):
        folder = self.root/'homr/.venv/bin'
        folder.mkdir(parents=True)
        python = folder/'python'
        python.write_text('unfinished')
        result = subprocess.run(['bash', '-c', 'source /scripts/common.sh; initialize homr'],
                                env={**os.environ, 'ENGINES_DIR': str(self.root),
                                     'ENGINES_VOLUME_NAME': 'issue138-test'}, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(python.read_text(), 'unfinished')
        self.assertFalse((self.root/'homr/INSTALL_MANIFEST.json').exists())

    def test_missing_volume_name_fails_before_any_engine_write(self):
        self.reject_volume('')

    def test_operating_volume_name_fails_before_any_engine_write(self):
        self.reject_volume('klassic_engines')

    def reject_volume(self, name):
        target = self.root/'must-not-be-created'
        result = subprocess.run(['bash', '-c', 'source /scripts/common.sh; initialize homr'],
                                env={**os.environ, 'ENGINES_DIR': str(target),
                                     'ENGINES_VOLUME_NAME': name}, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(target.exists())

    def test_marker_checks_input_locks_and_weight_corruption(self):
        folder = self.root/'homr'
        (folder/'.venv/bin').mkdir(parents=True)
        (folder/'.venv/bin/python').touch()
        (folder/'VERSION').write_text('0.7.0')
        weight = folder/'.venv/lib/python3.11/site-packages/model.onnx'
        weight.parent.mkdir(parents=True)
        weight.write_bytes(b'model')
        (self.locks/'sources.json').write_text(json.dumps({'homr': {'version': '0.7.0'}}))
        lock = self.locks/'homr/uv.lock'
        lock.write_text('fixed')
        (self.locks/'homr/weights.sha256.json').write_text(json.dumps({
            'model.onnx': {'bytes': 5, 'sha256': state.digest(weight)}}))
        with patch.dict(os.environ, ENGINES_DIR=str(self.root)):
            with patch.object(sys, 'argv', ['state', 'complete', 'homr']):
                state.main()
            with patch.object(sys, 'argv', ['state', 'verify', 'homr']):
                state.main()
                lock.write_text('changed')
                with self.assertRaisesRegex(ValueError, '잠금'):
                    state.main()
            weight.write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError, '해시'):
                state.validate('homr', self.root)


if __name__ == '__main__':
    unittest.main()
