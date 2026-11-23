# Adaptive image-detail preprocessing

The `auto` preset now derives a detail profile from the existing low-resolution image analysis and applies profile-specific preprocessing adjustments before mapping.

## Profiles

- `flat_graphic`: disables denoising and CLAHE to avoid softening clean fills and crisp outlines.
- `fine_detail`: uses restrained denoising, stronger fine sharpening, and low local-contrast enhancement.
- `painterly_texture`: limits denoising and sharpening to reduce loss of brush texture and gradients.
- `landscape`: uses gentler sharpening and modest local-contrast enhancement for broad sky, water, and foliage regions.
- `general`: conservative fallback values.

The profile selection is heuristic. It uses edge density, dominant quantized colors, high-pass residual noise, saturation, and luminance spread. It does **not** run face/object recognition; `fine_detail` must not be interpreted as a confirmed portrait or character detector. Human portraits, cartoons, flowers, and other colorful subjects can share similar low-level statistics.

## Run the supplied visual regression set

Eight representative images from the conversation are stored under `inputs/image-processing-tests/` with labels in `manifest.json`.

```bash
npm run test:image-profiles
```

The command prints the measured features and selected profile for each fixture. It checks basic safety bounds, but visual review is still required for halos, lost hair/linework, texture smearing, gradient banding, and false edge emphasis. This repository change has not been calibrated against a human-rated quality dataset; treat the profile weights as an initial adaptive baseline, not a validated universal optimum.
