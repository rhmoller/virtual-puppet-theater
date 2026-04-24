// src/welcome.ts — Speaks the one-time welcome line when the loader
// finishes. Owns its own utterance lifecycle (separate from the speak()
// queue in speech.ts) so it can bypass the queue on the first user
// gesture and work around browser autoplay policies directly.

let welcomeSpoken = false;

export function announceWelcome() {
  const synth = window.speechSynthesis;
  if (!synth || welcomeSpoken) return;

  const speak = () => {
    if (welcomeSpoken) return;
    const utter = new SpeechSynthesisUtterance(
      "Welcome to the Virtual Puppet Theater. Turn on your webcam and use your right hand to bring your puppet to life.",
    );
    utter.rate = 1.0;
    utter.pitch = 1.05;
    utter.volume = 1.0;
    const voices = synth.getVoices();
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
    const MALE_NAMES = /daniel|alex|fred|rishi|oliver|george|aaron|arthur|male|david|mark|james|\+m[1-7]\b/i;
    const preferred =
      en.find((v) => MALE_NAMES.test(v.name)) ||
      en.find((v) => v.name.toLowerCase().includes("google")) ||
      en[0];
    if (preferred) utter.voice = preferred;
    utter.onstart = () => { welcomeSpoken = true; };
    synth.cancel();
    synth.speak(utter);
  };

  const tryNow = () => {
    if (synth.getVoices().length > 0) speak();
    else synth.addEventListener("voiceschanged", speak, { once: true });
  };

  tryNow();

  // Autoplay policy: if the utterance never started within a moment (no
  // prior user gesture), arm one-shot gesture listeners to kick it off.
  setTimeout(() => {
    if (welcomeSpoken) return;
    const onGesture = () => {
      if (welcomeSpoken) return;
      speak();
    };
    const opts = { once: true, capture: true } as const;
    window.addEventListener("pointerdown", onGesture, opts);
    window.addEventListener("keydown", onGesture, opts);
    window.addEventListener("touchstart", onGesture, opts);
  }, 600);
}
