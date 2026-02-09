import shutil
import subprocess
from typing import Iterator, Optional

class PiperEngine:
    def __init__(
        self,
        model_path: str,
        speaker: Optional[int] = None,
        sample_rate: int = 16000,
        executable: str = "piper",
        chunk_size: int = 4096,
    ):
        self.model_path = model_path
        self.speaker = speaker
        self.sample_rate = sample_rate
        self.executable = executable
        self.chunk_size = chunk_size

        if not shutil.which(self.executable):
            raise RuntimeError(f"Piper executable not found: {self.executable}")
        if not self.model_path:
            raise RuntimeError("Piper model path is required")

    def stream(self, text: str) -> Iterator[bytes]:
        if not text:
            return
        cmd = [
            self.executable,
            "-m",
            self.model_path,
            "--output-raw",
            "--sample_rate",
            str(self.sample_rate),
        ]
        if self.speaker is not None:
            cmd += ["--speaker", str(self.speaker)]

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            assert proc.stdin is not None
            assert proc.stdout is not None
            proc.stdin.write(text.encode("utf-8"))
            proc.stdin.close()

            while True:
                chunk = proc.stdout.read(self.chunk_size)
                if not chunk:
                    break
                yield chunk

            stderr = proc.stderr.read() if proc.stderr else b""
            code = proc.wait()
            if code != 0:
                raise RuntimeError(f"Piper failed ({code}): {stderr.decode('utf-8', 'ignore')}")
        finally:
            try:
                if proc.stdout:
                    proc.stdout.close()
                if proc.stderr:
                    proc.stderr.close()
            except Exception:
                pass
