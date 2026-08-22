# Adaptive Delay

This context describes the privacy-safe timing concepts used to adapt a debounce wait to local interaction rhythm.

## Language

**Interaction cadence**:
The rhythm formed by elapsed time between qualifying interactions in a burst. It excludes entered content and the identity of the person or field.
_Avoid_: Typing speed, WPM

**Adaptive delay**:
A stable, bounded wait recommendation learned from interaction cadence.
_Avoid_: Timeout, typing delay

**Adaptive delay state**:
The minimal transferable learning needed to continue an adaptive delay without retaining raw interactions, timestamps, content, or identity.
_Avoid_: User profile, typing history
