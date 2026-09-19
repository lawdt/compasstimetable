#!/usr/bin/env bash
# Сборка apk. Отдельный скрипт нужен из-за JDK: Android Gradle Plugin
# принимает 17–21, а в системе часто стоит свежее. Android Studio приносит
# с собой подходящий JDK, его и берём.
set -euo pipefail

cd "$(dirname "$0")/.."

for candidate in \
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  "${JAVA_HOME:-}" ; do
  if [ -n "$candidate" ] && [ -x "$candidate/bin/java" ]; then
    version=$("$candidate/bin/java" -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')
    if [ "$version" -ge 17 ] && [ "$version" -le 21 ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  fi
done

if [ -z "${JAVA_HOME:-}" ]; then
  echo "Нужен JDK 17–21. Поставьте Android Studio или задайте JAVA_HOME." >&2
  exit 1
fi

echo "JDK: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
exec android/gradlew -p android "${@:-:app:assembleDebug}"
