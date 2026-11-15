# Jarvis local design comparison

Both designs are preserved as local Git branches. Neither version was pushed or
deployed as part of this comparison.

| Version | Local branch | Preview during this review |
| --- | --- | --- |
| Agricultural design | `work/jarvis-agricultural-snapshot` | http://127.0.0.1:8082/ |
| Space and orbital design with Cooper panels | `work/jarvis-orbital-comparison` | http://127.0.0.1:8081/ |

Open **Jarvis** from Cooper's navigation in either preview.

## Agricultural design

Saved at commit `d812eb7`. This version keeps the compact Cooper header, the
separate conversation panel, a large satellite globe, continuously moving terrain
contours and soft ambient light. Its background uses one non-repeating vector
surface to avoid tile seams.

The second preview is an export of that commit under the ignored
`dist/jarvis-agricultural-preview` directory. It does not change when the orbital
branch is edited. It uses the same locally configured backend credentials without
including the ignored `.env` file in the snapshot.

## Orbital comparison

This version restores the original scene's Three.js orbital rings, star particles
and voice bars inside the dedicated 3D pane. The scene uses a space background;
Cooper's compact header, navigation, fonts, theme-aware panels and Back to Cooper
button remain. Chat body text is 14 px, below the 18 px heading.

The globe leaves space for the orbital frame, and the chat stays outside the
renderer viewport. Continuous ring and star motion pauses with reduced-motion
preferences. The agricultural version remains available on its own branch.

## Returning to either design

With a clean working tree, use `git switch` with the branch name above. The main
development server serves the currently checked-out version on port 8081.
Port 8082 is a separate server for the exported agricultural snapshot; preview
servers must be running for these addresses to work.
