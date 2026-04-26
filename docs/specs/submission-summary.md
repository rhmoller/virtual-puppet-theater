# Submission summary (≈180 words)

A kid raises a hand to the webcam and a puppet comes to life — mouth, eyes, and gestures driven by their fingers via MediaPipe. An AI puppet on stage listens with words AND body language, and replies in character.

When the kid says "let's go to the beach", a sun, a sand castle, and a beach ball appear. When they say "I want sunglasses on my puppet", sunglasses appear. When they say "I want a watermelon hat" — something the catalog doesn't have — the AI says "ooh, let me dream that up!" and a few seconds later a watermelon-shaped hat fades onto its head. Asked again, it pops in instantly from cache.

Behind the scenes, two Claudes work in parallel. A conversation Claude performs the live character with emotion, gaze, and gestures. A separate Claude — always Opus 4.7 — designs each novel prop on the fly from a tight set of THREE.js primitives. Its compositional reasoning is what makes the co-creation feel real-time.

An interface for play that didn't exist a year ago.
