set -euo pipefail
cd /Users/rayliu/Documents/orca
IDENTITY=$(node --input-type=module -e "import {getLocalBuildIdentity} from './config/scripts/desktop-distribution/macos/build-mac-local.mjs'; const i=getLocalBuildIdentity(); console.log(i.commit+' '+i.version)")
COMMIT=${IDENTITY%% *}
VERSION=${IDENTITY#* }
echo "[build] commit=$COMMIT version=$VERSION"
pnpm run build:desktop
pnpm run build:computer-macos
pnpm run build:keyboard-layout-macos
pnpm run build:process-footprint-macos
pnpm run build:notification-status-macos
pnpm run ensure:electron-runtime
ORCA_BUILD_COMMIT="$COMMIT" ORCA_LOCAL_BUILD_VERSION="$VERSION" pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64
echo "[build] DONE"