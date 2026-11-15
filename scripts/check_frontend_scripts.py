"""Syntax-check inline scripts too, including the explanation module's fallbacks."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.collect = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.collect = "src" not in dict(attrs) and dict(attrs).get("type", "") in ("", "module", "text/javascript")
            self.parts = []

    def handle_data(self, data):
        if self.collect:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.collect:
            subprocess.run(["node", "--check", "--input-type=module"], input="".join(self.parts), text=True, encoding="utf-8", check=True)
            self.collect = False


if __name__ == "__main__":
    for path in Path("frontend").rglob("*.html"):
        Scripts().feed(path.read_text(encoding="utf-8"))
    print("Frontend inline script syntax passed")
