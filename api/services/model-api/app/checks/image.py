"""#29·#30 인식용 사진 사본 준비.

구조에서의 위치: checks.upload → 이 파일 → Pillow·NumPy → 구조 검사·인식 엔진.
원본을 보존하고 EXIF 방향·투명 배경·16비트 명암을 반영한 RGB PNG를 메모리에서 만든다.
"""
import io

import numpy as np
from PIL import Image, ImageOps


def recognition_copy(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("I", "I;16", "I;16B", "I;16L"):
            # convert('RGB')는 255보다 큰 16비트 값을 흰색으로 잘라 버린다.
            gray = np.rint(np.clip(np.asarray(image, dtype=np.float64), 0, 65535) / 257).astype(np.uint8)
            result = Image.fromarray(gray).convert("RGB")
        elif "A" in image.getbands() or "transparency" in image.info:
            rgba = image.convert("RGBA")
            result = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
        else:
            result = image.convert("RGB")
        result.info.clear()
        output = io.BytesIO()
        result.save(output, format="PNG")
        return output.getvalue()
