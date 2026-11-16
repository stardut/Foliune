beUI public Expandable Action Bar

Source: https://beui.dev/r/expandable-action-bar.json
Documentation: https://beui.dev/components/blocks/expandable-action-bar
Retrieved: 2026-10-29
License: MIT, see LICENSE.

All registry files are retained. Import paths were adjusted to this local directory. Foliune composes the bar with visible labels and immediate actions.


beUI public Animated Toast Stack

Source: https://beui.dev/r/animated-toast-stack.json
Documentation: https://beui.dev/components/motion/animated-toast-stack
Retrieved: 2026-11-03 via public beUI MCP get_component.
License: MIT, see LICENSE.

Foliune adapts the source's stack and per-toast timer composition for the requested top-right feedback. The implementation is reduced to success/error/info, independently timed messages, repeat-message lifetime reset, semantic icons, wrapping copyable text and optional close controls. It reuses existing desktop materials and dependencies. Entrance uses visible CSS translation with reduced-motion support; removal is immediate, without AnimatePresence or initial opacity. ToastProvider owns manual-popover top-layer placement and follows the shared modal stack's actual showModal order. Unused preview, actions, swipe gestures, configurable placement and motion helpers were omitted.


beUI public Wheel Picker

Source: https://beui.dev/r/wheel-picker.json
Documentation: https://beui.dev/components/motion/wheel-picker
Retrieved: 2026-11-13 from the public registry.
License: MIT, see LICENSE.

Foliune adapts the source's two-layer cylinder, projection, pointer capture, drag momentum and wheel snapping for bounded numeric fields. Both layers render only nearby rows so the year range remains usable. The desktop styles reuse existing theme variables, with an unanimated flat wheel for reduced motion. The date dialog provides text entry and uses the wheel as an accessible spinbutton. Unused generic option, sizing and audio code was omitted, and the shared touch helpers were reused.
