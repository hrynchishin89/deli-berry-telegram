const TRANSITIONS = {
  new: ['accepted', 'canceled'],
  accepted: ['paid', 'cooking', 'ready', 'canceled'],
  paid: ['cooking', 'ready', 'canceled'],
  cooking: ['paid', 'ready', 'canceled'],
  ready: ['delivering', 'done'],
  delivering: ['done'],
  done: [],
  canceled: []
};

function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[from]?.includes(to));
}

function transitionError(from, to) {
  if (to === 'ready' && !['accepted', 'paid', 'cooking', 'ready'].includes(from)) {
    return 'Сначала подтвердите заказ';
  }
  if (to === 'done' && !['ready', 'delivering', 'done'].includes(from)) {
    return 'Сначала поставьте статус «Заказ готов»';
  }
  return `Нельзя изменить статус с «${from}» на «${to}»`;
}

module.exports = { TRANSITIONS, canTransition, transitionError };
