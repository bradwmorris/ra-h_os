#!/usr/bin/env bash
# Replaces /usr/local/bin/node inside the prerelease-node test image.
# Intercepts only the version-string call install.sh makes; all other
# invocations exec the real Node binary at /usr/local/bin/node-real.
if [[ "$1" == "-p" && "$2" == "process.versions.node" ]]; then
  echo "20.18.1-rc.1"
else
  exec /usr/local/bin/node-real "$@"
fi
