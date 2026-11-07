Local unpublished extension of @revyme/runtime 0.0.32. It provides Revyme's
Displacement, Glitch, Glyph Rain, Ripple and Particle Object implementations.
The latter effects were independently implemented using Canvas UI as a visual
reference. Includes html-to-image 1.11.13 (MIT); see HTML-TO-IMAGE-LICENSE.

Glitch and Ripple can run during route changes. The four newer effects can be
applied to individual elements; Particle Object targets images and inline SVG.
Snapshot-based effects return to ordinary DOM rendering when capture or WebGL
fails. Particle Object leaves the original visible if its source cannot be
read. Animations respect reduced motion and stop while offscreen or hidden.
