/* Sticker sets — emoji-based "stickers" (large animated glyphs). Original set. */
(function () {
  const Stickers = {
    packs: [
      { id: 'animals', title: 'Animals', icon: '🐻',
        items: ['🐻','🐸','🐼','🦊','🦁','🐨','🐵','🐧','🐷','🐰','🐯','🐮','🐹','🐔','🦄','🐙','🦉','🦋'] },
      { id: 'faces', title: 'Emotions', icon: '😀',
        items: ['😀','😂','🥰','😎','🤔','😴','🤯','😭','😡','🥳','😇','🤩','😅','😉','🙄','😱','🤗','😬'] },
      { id: 'hands', title: 'Gestures', icon: '👍',
        items: ['👍','👎','👏','🙌','🤝','✌️','🤞','👌','🤟','🖐️','✋','👋','🙏','💪','👀','🫶','🤙','🫡'] },
      { id: 'love', title: 'Love', icon: '❤️',
        items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💖','💕','💘','💝','💞','😍','😘','🥰','💋','💯'] },
      { id: 'food', title: 'Food', icon: '🍕',
        items: ['🍕','🍔','🍟','🌮','🍣','🍜','🍩','🍦','🍎','🍑','🍓','🥑','🍺','☕','🍰','🧁','🍫','🥂'] },
      { id: 'party', title: 'Party', icon: '🎉',
        items: ['🎉','🎊','🎈','🎁','🥳','🎂','✨','🔥','⭐','🌟','💫','🏆','🎆','🎇','🪄','🎯','🚀','💎'] },
    ],
    recent: [],
    favorites: ['⭐','🔥','😂','❤️','👍','🥺'],
    all() { return this.packs.flatMap((p) => p.items); },
    random() { const a = this.all(); return a[Math.floor(Math.random() * a.length)]; },
    addRecent(s) { this.recent = [s, ...this.recent.filter((x) => x !== s)].slice(0, 24); },
  };
  window.Stickers = Stickers;
})();
