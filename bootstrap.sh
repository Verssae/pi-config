#!/usr/bin/env bash
# pi-config bootstrap — 소스를 ~/.pi/agent에 심링크하고 패키지를 설치한다.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HOME/.pi/agent"

mkdir -p "$AGENT"

# 1) 디렉토리/파일 심링크 (기존 실디렉토리는 백업으로 이동)
link() {
  local name="$1" target="$SRC/$1"
  if [[ -L "$AGENT/$name" ]]; then
    return
  fi
  if [[ -e "$AGENT/$name" ]]; then
    local backup="$AGENT.backup/$(date +%Y%m%d)/$name"
    mkdir -p "$(dirname "$backup")"
    mv "$AGENT/$name" "$backup"
  fi
  ln -s "$target" "$AGENT/$name"
  echo "linked: $AGENT/$name -> $target"
}

link extensions
link skills
link agents
link settings.json

# 2) 패키지 설치 (로컬 확장은 절대경로로)
while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  pkg="${pkg//local:/$SRC/}"
  echo "installing: $pkg"
  pi install "$pkg" || echo "WARN: install failed: $pkg"
done < <(jq -r '.[]' "$SRC/packages.json")

echo "done. /reload or restart pi to apply."
