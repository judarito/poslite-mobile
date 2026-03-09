#!/usr/bin/env sh
set -eu

TARGET="node_modules/llama.rn/android/build.gradle"

if [ ! -f "$TARGET" ]; then
  echo "[postinstall] llama.rn no instalado, se omite parche."
  exit 0
fi

if grep -q 'rootProject.getProperty("newArchEnabled").toString().toBoolean()' "$TARGET"; then
  echo "[postinstall] parche llama.rn ya aplicado."
  exit 0
fi

TMP_FILE="$(mktemp)"
sed 's/return rootProject.hasProperty("newArchEnabled") && rootProject.getProperty("newArchEnabled") == "true"/return rootProject.hasProperty("newArchEnabled") \&\& rootProject.getProperty("newArchEnabled").toString().toBoolean()/' "$TARGET" > "$TMP_FILE"

if cmp -s "$TARGET" "$TMP_FILE"; then
  rm -f "$TMP_FILE"
  echo "[postinstall] no se encontro patron en llama.rn; sin cambios."
  exit 0
fi

mv "$TMP_FILE" "$TARGET"
echo "[postinstall] parche llama.rn aplicado correctamente."
