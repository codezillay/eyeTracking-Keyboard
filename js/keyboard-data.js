/* ==========================================================================
   keyboard-data.js
   Defines the keyboard layouts (letters/numbers/symbols) and quick phrases
   used by the GazeSpeak communication keyboard.
   ========================================================================== */

// Main QWERTY layout, split into rows. Each key is either a plain letter/
// symbol (typed as-is) or an object describing a special action key.
const KEYBOARD_LAYOUTS = {
  letters: [
    [
      { label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' },
      { label: '4', value: '4' }, { label: '5', value: '5' }, { label: '6', value: '6' },
      { label: '7', value: '7' }, { label: '8', value: '8' }, { label: '9', value: '9' },
      { label: '0', value: '0' },
      { label: '⌫', action: 'backspace', cls: 'backspace-key', wide: true }
    ],
    [
      { label: 'Q', value: 'q' }, { label: 'W', value: 'w' }, { label: 'E', value: 'e' },
      { label: 'R', value: 'r' }, { label: 'T', value: 't' }, { label: 'Y', value: 'y' },
      { label: 'U', value: 'u' }, { label: 'I', value: 'i' }, { label: 'O', value: 'o' },
      { label: 'P', value: 'p' }
    ],
    [
      { label: 'A', value: 'a' }, { label: 'S', value: 's' }, { label: 'D', value: 'd' },
      { label: 'F', value: 'f' }, { label: 'G', value: 'g' }, { label: 'H', value: 'h' },
      { label: 'J', value: 'j' }, { label: 'K', value: 'k' }, { label: 'L', value: 'l' },
      { label: "'", value: "'" }
    ],
    [
      { label: '⇧', action: 'shift', cls: 'special' },
      { label: 'Z', value: 'z' }, { label: 'X', value: 'x' }, { label: 'C', value: 'c' },
      { label: 'V', value: 'v' }, { label: 'B', value: 'b' }, { label: 'N', value: 'n' },
      { label: 'M', value: 'm' }, { label: ',', value: ',' }, { label: '.', value: '.' },
      { label: '?', value: '?' }
    ],
    [
      { label: '#+=', action: 'symbols', cls: 'special' },
      { label: 'Space', value: ' ', cls: 'space-key' },
      { label: '↵ Enter', action: 'enter', cls: 'enter-key action-key', wide: true }
    ]
  ],

  symbols: [
    [
      { label: '!', value: '!' }, { label: '@', value: '@' }, { label: '#', value: '#' },
      { label: '$', value: '$' }, { label: '%', value: '%' }, { label: '^', value: '^' },
      { label: '&', value: '&' }, { label: '*', value: '*' }, { label: '(', value: '(' },
      { label: ')', value: ')' },
      { label: '⌫', action: 'backspace', cls: 'backspace-key', wide: true }
    ],
    [
      { label: '-', value: '-' }, { label: '_', value: '_' }, { label: '=', value: '=' },
      { label: '+', value: '+' }, { label: '/', value: '/' }, { label: ':', value: ':' },
      { label: ';', value: ';' }, { label: '"', value: '"' }, { label: '(', value: '(' },
      { label: ')', value: ')' }
    ],
    [
      { label: '%', value: '%' }, { label: '$', value: '$' }, { label: '&', value: '&' },
      { label: '*', value: '*' }, { label: '@', value: '@' }, { label: '!', value: '!' },
      { label: '?', value: '?' }, { label: ',', value: ',' }, { label: '.', value: '.' },
      { label: "'", value: "'" }
    ],
    [
      { label: 'ABC', action: 'letters', cls: 'special', wide: true },
      { label: '😀', value: '🙂' }, { label: '👍', value: '👍' }, { label: '❤️', value: '❤️' },
      { label: '🙏', value: '🙏' }, { label: '💧', value: '💧' }, { label: '🍽️', value: '🍽️' },
      { label: '🛌', value: '🛌' }
    ],
    [
      { label: '#+=', action: 'symbols', cls: 'special' },
      { label: 'Space', value: ' ', cls: 'space-key' },
      { label: '↵ Enter', action: 'enter', cls: 'enter-key action-key', wide: true }
    ]
  ]
};

// Quick phrases for fast, common-need communication (grouped roughly by urgency/topic)
const QUICK_PHRASES = [
  { icon: 'fa-triangle-exclamation', text: 'I need help now', urgent: true },
  { icon: 'fa-user-nurse', text: 'Please call the nurse', urgent: true },
  { icon: 'fa-face-grimace', text: 'I am in pain', urgent: true },
  { icon: 'fa-lungs', text: "I can't breathe well", urgent: true },
  { icon: 'fa-glass-water', text: 'I am thirsty' },
  { icon: 'fa-utensils', text: 'I am hungry' },
  { icon: 'fa-bed', text: 'I want to lie down' },
  { icon: 'fa-chair', text: 'I want to sit up' },
  { icon: 'fa-temperature-high', text: 'I feel too hot' },
  { icon: 'fa-snowflake', text: 'I feel too cold' },
  { icon: 'fa-toilet', text: 'I need the bathroom' },
  { icon: 'fa-hand', text: 'Please wait a moment' },
  { icon: 'fa-thumbs-up', text: 'Yes' },
  { icon: 'fa-thumbs-down', text: 'No' },
  { icon: 'fa-face-smile', text: "I'm okay, thank you" },
  { icon: 'fa-heart', text: 'I love you' },
  { icon: 'fa-comment', text: 'I want to talk' },
  { icon: 'fa-tv', text: 'Please turn on the TV' },
  { icon: 'fa-volume-xmark', text: 'Please turn down the noise' },
  { icon: 'fa-pills', text: 'I need my medicine' },
  { icon: 'fa-phone', text: 'Please call my family' },
  { icon: 'fa-house', text: 'I want to go home' },
  { icon: 'fa-circle-question', text: 'What time is it?' },
  { icon: 'fa-hand-peace', text: 'Thank you' }
];

// Simple offline word-prediction dictionary (frequency-ranked common English words)
// used for next-word / prefix suggestions above the keyboard.
const WORD_DICTIONARY = [
  'the','I','you','a','to','and','is','of','it','in','my','me','that','for','on',
  'am','are','was','not','have','has','need','want','please','help','yes','no',
  'water','food','pain','hurt','thirsty','hungry','tired','cold','hot','nurse',
  'doctor','bathroom','medicine','family','love','okay','thank','thanks','sorry',
  'good','bad','more','less','stop','wait','go','come','sit','stand','sleep',
  'eat','drink','feel','feeling','today','tomorrow','yesterday','now','later',
  'can','cant','could','would','will','how','what','when','where','why','who',
  'this','that','these','those','with','without','again','please','call','tv',
  'phone','home','room','bed','up','down','left','right','yes','no','maybe',
  'hello','hi','bye','goodbye','see','talk','speak','read','write','turn',
  'on','off','open','close','light','dark','quiet','loud','music','tired'
];
