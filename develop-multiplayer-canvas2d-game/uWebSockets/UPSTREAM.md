# Vendored µWebSockets + µSockets

This directory contains a static vendored copy of the C++ WebSocket library and
its µSockets dependency, so the Docker build is fully self-contained and does not
clone from GitHub during the image build.

Some build environments (including the Render Docker build used by
`render.yaml`) fail `git clone https://github.com/uNetworking/uWebSockets.git`
with `could not read Username for 'https://github.com'` / `expected flush after
ref listing`, so the dependency is vendored instead.

Upstream provenance (view the repo's LICENSE for terms — Apache-2.0):

| Component    | Upstream                                   | Pinned commit                              |
| ------------ | ------------------------------------------ | ------------------------------------------ |
| µWebSockets  | https://github.com/uNetworking/uWebSockets | `1f971721f0a0facafb1397eecf6682196f526d84` |
| µSockets     | https://github.com/uNetworking/uSockets    | `86097c490263ab662d62e8e7b541390bdec7d149` |

Layout mirrors what the previous `git clone` + `git submodule update` produced:

- `src/` — µWebSockets headers (added to the include path via `-IuWebSockets/src`)
- `uSockets/` — the µSockets submodule tree (built with `make -C uSockets`,
  headers via `-IuWebSockets/uSockets/src`, objects linked as `uWebSockets/uSockets/*.o`)

To refresh, re-clone upstream and copy the files back here, keeping the pinned
revision table above in sync.
