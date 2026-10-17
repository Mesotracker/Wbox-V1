Checkpoint 1 - error-free in smoke test (512 default world, 3D view, possession, house entry,
all weather types, supercell + volcano). Contains:
- world size: 512 default (4x area), geography scales with size, land reaches near map edges, whole-map start view
- tv_rework.js: solid buildings, damage, rivers, roads, ships, ground cover (bushes rescaled)
- tv_clouds.js: volumetric cumulonimbus + volcanic plumes, new sky (cumulus/alto/cirrus/halo), storm ground shadows
Open checkpoint_1/index.html through a local web server (python3 -m http.server).
