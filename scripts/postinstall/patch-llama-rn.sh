#!/usr/bin/env sh
set -eu

TARGET="node_modules/llama.rn/android/build.gradle"

if [ ! -f "$TARGET" ]; then
  echo "[postinstall] llama.rn no instalado, se omite parche."
  exit 0
fi

TMP_FILE="$(mktemp)"
cp "$TARGET" "$TMP_FILE"

# Fix 1: parse boolean safely from gradle property.
sed -i 's/return rootProject.hasProperty("newArchEnabled") && rootProject.getProperty("newArchEnabled") == "true"/return rootProject.hasProperty("newArchEnabled") \&\& rootProject.getProperty("newArchEnabled").toString().toBoolean()/' "$TMP_FILE"

# Fix 2: always apply RN Gradle plugin so NativeRNLlamaSpec is generated
# even when the app builds with -PnewArchEnabled=false.
sed -i 's/^if (isNewArchitectureEnabled()) {$/if (true) {/g' "$TMP_FILE"

if cmp -s "$TARGET" "$TMP_FILE"; then
  rm -f "$TMP_FILE"
  echo "[postinstall] no se encontraron cambios pendientes en llama.rn."
  exit 0
fi

mv "$TMP_FILE" "$TARGET"
echo "[postinstall] parche llama.rn aplicado correctamente."
