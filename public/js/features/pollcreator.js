/* Poll creator — a pushed screen to compose a poll. PollCreator.open({ onCreate }) */
(function () {
  const UI = window.UI, h = UI.h;

  function buildPoll(opts) {
    const state = { multiple: false, quiz: false, correct: null };
    const root = h('div', { class: 'col', style: { height: '100%', background: 'var(--bg)' } });
    const create = UI.textBtn('Создать', submit, 'title-text');
    create.style.opacity = .4; create.style.pointerEvents = 'none';
    const nav = UI.header({ left: UI.textBtn('Отмена', () => App.pop()), title: 'Новый опрос', right: create });
    nav.classList.add('solid'); root.appendChild(nav);

    const content = h('div', { class: 'content scroll', style: { paddingTop: '10px' } });
    root.appendChild(content);

    content.appendChild(h('div', { class: 'list-title', text: 'ВОПРОС' }));
    const qInput = h('textarea', { class: 'poll-input', placeholder: 'Задайте вопрос', rows: 2 });
    content.appendChild(h('div', { class: 'field' }, qInput));

    content.appendChild(h('div', { class: 'list-title', text: 'ВАРИАНТЫ ОТВЕТА' }));
    const optsWrap = h('div', { class: 'field' });
    content.appendChild(optsWrap);
    const optionInputs = [];
    function addOption() {
      if (optionInputs.length >= 10) return;
      const inp = h('input', { class: 'poll-input', placeholder: 'Добавить вариант' });
      const obj = { el: inp };
      inp.addEventListener('input', () => {
        validate();
        if (inp.value && obj === optionInputs[optionInputs.length - 1] && optionInputs.length < 10) addOption();
      });
      optionInputs.push(obj); optsWrap.appendChild(inp); renderOptionMarks(); validate();
    }
    addOption(); addOption();

    content.appendChild(h('div', { class: 'list-title', text: 'НАСТРОЙКИ' }));
    const multiSwitch = UI.switchEl(false, (v) => { state.multiple = v; if (v) { state.quiz = false; quizSwitch.classList.remove('on'); renderOptionMarks(); } validate(); });
    const quizSwitch = UI.switchEl(false, (v) => { state.quiz = v; if (v) { state.multiple = false; multiSwitch.classList.remove('on'); } renderOptionMarks(); validate(); });
    content.appendChild(UI.group([
      UI.cell({ title: 'Несколько ответов', chevron: false, right: multiSwitch }),
      UI.cell({ title: 'Режим викторины', chevron: false, right: quizSwitch }),
    ]));
    content.appendChild(h('div', { class: 'field-hint', text: 'В режиме викторины нажмите на вариант, чтобы отметить правильный ответ.' }));

    function renderOptionMarks() {
      optionInputs.forEach((o, i) => {
        o.el.onclick = null; o.el.style.background = '';
        if (state.quiz) o.el.onclick = () => { state.correct = i; optionInputs.forEach((x) => x.el.style.background = ''); o.el.style.background = 'rgba(77,203,93,.18)'; validate(); };
      });
      if (!state.quiz) state.correct = null;
    }
    function validate() {
      const q = qInput.value.trim();
      const opts2 = optionInputs.map((o) => o.el.value.trim()).filter(Boolean);
      const ok = q.length > 0 && opts2.length >= 2 && (!state.quiz || state.correct != null);
      create.style.opacity = ok ? 1 : .4; create.style.pointerEvents = ok ? 'auto' : 'none';
    }
    qInput.addEventListener('input', validate);
    function submit() {
      const question = qInput.value.trim();
      const options = optionInputs.map((o) => o.el.value.trim()).filter(Boolean);
      if (!question || options.length < 2) return;
      opts.onCreate({ question, options, multiple: state.multiple, quiz: state.quiz, correct: state.correct });
      App.pop();
    }
    return root;
  }

  App.registerScreen('__poll__', { render(params) { return buildPoll(params.opts || { onCreate() {} }); } });

  window.PollCreator = { open(opts) { App.push('__poll__', { opts }); } };

  const st = document.createElement('style');
  st.textContent = '.poll-input{width:100%;padding:13px 16px;border:none;outline:none;background:transparent;color:var(--text);font-size:17px;resize:none}.poll-input+.poll-input{border-top:.5px solid var(--sep)}';
  document.head.appendChild(st);
})();
