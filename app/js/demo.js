// Built-in demo content so new users can explore every feature immediately.
import { create, setSetting } from './store.js';
import { uid } from './lib.js';
import * as D from './dates.js';

const b = (type, html = '', extra = {}) => ({ id: uid('b'), type, html, ...extra });

export function loadDemo() {
  const T = D.today();
  const d = (n) => D.addDays(T, n);
  const at = (n, h, m = 0) => d(n) + 'T' + D.pad(h) + ':' + D.pad(m);
  const ws = D.startOfWeek(T, 1);

  const work = create('folder', { name: 'Work', color: '#0090ff', icon: { type: 'emoji', value: '💼' }, order: 1 });
  const home = create('folder', { name: 'Home', color: '#30a46c', icon: { type: 'emoji', value: '🏠' }, order: 2 });
  const side = create('folder', { name: 'Side project', color: '#d6409f', icon: { type: 'emoji', value: '🚀' }, order: 3 });
  const focus = create('tag', { name: 'focus', color: '#6e56cf' });
  const errand = create('tag', { name: 'errand', color: '#f76b15' });
  const reading = create('tag', { name: 'reading', color: '#12a594' });
  const idea = create('tag', { name: 'idea', color: '#ffb224', icon: { type: 'emoji', value: '💡' } });

  // ---- tasks ----
  const report = create('task', {
    title: 'Finish the quarterly report', when: { kind: 'day', date: T, time: '10:00' }, deadline: d(2), priority: 3,
    folderId: work.id, tags: [focus.id], reminder: T + 'T10:00',
    notes: [b('p', 'Pull the numbers from the <b>sales sheet</b>, then add two charts.'), b('todo', 'Revenue by region', { checked: true }), b('todo', 'Churn chart')],
  });
  create('task', { title: 'Collect numbers from finance', parentId: report.id, folderId: work.id, status: 'done', completedAt: Date.now() - 3600000 });
  create('task', { title: 'Draft the summary section', parentId: report.id, folderId: work.id });
  create('task', { title: 'Review with Ana', parentId: report.id, folderId: work.id, people: ['Ana'] });
  create('task', { title: 'Reply to the client email', when: { kind: 'day', date: T }, priority: 2, folderId: work.id });
  create('task', {
    title: 'Buy groceries', when: { kind: 'day', date: T }, tags: [errand.id], folderId: home.id,
    notes: [b('todo', 'Strawberries 🍓'), b('todo', 'Oat milk'), b('todo', 'Coffee beans', { checked: true })],
  });
  create('task', { title: 'Pay the electricity bill', when: { kind: 'day', date: d(-1) }, deadline: d(-1), priority: 4, folderId: home.id });
  create('task', { title: 'Book a dentist appointment', when: { kind: 'day', date: d(1) }, tags: [errand.id], folderId: home.id });
  create('task', { title: 'Sketch landing page ideas', when: { kind: 'day', date: d(2) }, folderId: side.id, tags: [idea.id], status: 'doing' });
  create('task', { title: 'Prepare slides for the demo', when: { kind: 'day', date: d(3) }, folderId: work.id, status: 'waiting', priority: 2 });
  create('task', { title: 'Set up the project repo', when: { kind: 'week', date: ws }, folderId: side.id });
  create('task', { title: 'Plan the team offsite', when: { kind: 'month', date: D.startOfMonth(T) }, folderId: work.id });
  create('task', { title: 'Renew passport', when: { kind: 'week', date: D.addDays(ws, 7) }, deadline: d(25), folderId: home.id, tags: [errand.id] });
  create('task', { title: 'Learn watercolour painting', when: { kind: 'someday' }, tags: [idea.id] });
  create('task', { title: 'Read “The Creative Habit”', when: { kind: 'someday' }, tags: [reading.id] });
  create('task', { title: 'Call the bank about the new card' });
  create('task', { title: 'Try the Quick Launcher — press Alt+Space' });

  // ---- habits with some history ----
  const past = (n, skip = []) => Array.from({ length: n }, (_, i) => d(-i - 1)).filter((_, i) => !skip.includes(i));
  create('task', { title: 'Morning walk', repeat: { freq: 'day', interval: 1, anchor: d(-21) }, when: { kind: 'day', date: T, time: '07:30' }, completions: past(9) });
  create('task', { title: 'Read 20 pages', repeat: { freq: 'day', interval: 1, anchor: d(-30) }, when: { kind: 'day', date: T, time: '21:00' }, tags: [reading.id], completions: past(16, [6, 7]) });
  const gymRule = { freq: 'week', interval: 1, days: [1, 3, 5], anchor: d(-35) };
  const gymPast = D.occurrencesBetween(gymRule, d(-35), d(-1)).filter((_, i, a) => i !== a.length - 6);
  const gymNext = D.occursOn(gymRule, T) ? T : D.nextOccurrence(gymRule, T);
  create('task', { title: 'Gym', repeat: gymRule, when: { kind: 'day', date: gymNext, time: '18:00' }, completions: gymPast, folderId: home.id });
  create('task', { title: 'Weekly review', repeat: { freq: 'week', interval: 1, days: [5], anchor: d(-28) }, when: { kind: 'day', date: D.occursOn({ freq: 'week', days: [5], anchor: d(-28) }, T) ? T : D.nextOccurrence({ freq: 'week', interval: 1, days: [5], anchor: d(-28) }, T) }, folderId: work.id,
    completions: D.occurrencesBetween({ freq: 'week', interval: 1, days: [5], anchor: d(-28) }, d(-28), d(-1)) });

  // ---- events ----
  const standup = create('event', { title: 'Team standup', start: at(0, 9, 30), end: at(0, 9, 45), folderId: work.id, url: 'https://meet.google.com/new', reminder: 5 });
  create('event', { title: 'Lunch with Sam', start: at(0, 12, 30), end: at(0, 13, 30), location: 'Corner Café', color: '#f76b15' });
  create('event', { title: 'Focus block', start: at(0, 14), end: at(0, 16), folderId: work.id, color: '#6e56cf', tags: [focus.id] });
  create('event', { title: 'Design review', start: at(1, 14), end: at(1, 15), folderId: work.id, url: 'https://meet.google.com/new' });
  create('event', { title: 'Team standup', start: at(1, 9, 30), end: at(1, 9, 45), folderId: work.id, url: 'https://meet.google.com/new', reminder: 5 });
  create('event', { title: 'Yoga class', start: at(2, 18), end: at(2, 19), folderId: home.id, color: '#30a46c' });
  create('event', { title: 'Product demo', start: at(3, 15), end: at(3, 16), folderId: work.id, location: 'Room 4B' });
  create('event', { title: 'Dinner with family', start: at(4, 19), end: at(4, 21), folderId: home.id, color: '#30a46c' });
  const sat = D.addDays(T, (6 - D.dow(T) + 7) % 7 || 7);
  create('event', { title: 'Weekend trip 🏖️', start: sat + 'T00:00', end: D.addDays(sat, 1) + 'T00:00', allDay: true, color: '#f76b15', folderId: home.id });

  // ---- notes ----
  const meeting = create('note', {
    title: 'Standup notes', folderId: work.id, icon: { type: 'emoji', value: '🗒️' }, links: [standup.id],
    blocks: [b('h2', 'Yesterday'), b('ul', 'Shipped the onboarding fixes'), b('ul', 'Reviewed analytics dashboard'), b('h2', 'Today'),
      b('ul', `Finish <span class="mention m-task" contenteditable="false" data-ref="${report.id}">Finish the quarterly report</span>`), b('h2', 'Blockers'), b('p', 'None 🎉')],
  });
  const ideasTask = create('task', { title: 'Write the project README', folderId: side.id });
  create('note', {
    title: 'Welcome to JamDay', icon: { type: 'emoji', value: '🍓' }, cover: { type: 'preset', id: 'jam' }, pinned: true,
    blocks: [
      b('callout', 'JamDay keeps your <b>tasks, notes and calendar</b> together — privately, on this device. This note is a playground: edit anything.', { emoji: '👋' }),
      b('h2', 'Things to try'),
      b('todo', 'Press <b>Alt+Space</b> (or Ctrl+K) to open the Quick Launcher'),
      b('todo', 'Type <code>/</code> anywhere in a note — even mid-line — for blocks like tables, tasks and events'),
      b('todo', `Type <code>@</code> to mention something, like <span class="mention m-note" contenteditable="false" data-ref="${meeting.id}">Standup notes</span>`),
      b('todo', 'Press <b>Ctrl+Alt+Space</b> to open the Quick panel'),
      b('todo', 'Drag a task onto another day in Upcoming or the calendar', { checked: true }),
      b('h2', 'Quick tokens'),
      b('table', '', { header: true, rows: [['Token', 'Means', 'Example'], ['<code>@</code>', 'Date / time / repeat', '@tomorrow 3pm · @every weekday'], ['<code>#</code>', 'Tag', '#errand'], ['<code>&amp;</code>', 'Folder', '&amp;Work'], ['<code>!</code>', 'Priority', '!high · !!'], ['<code>+</code>', 'Person', '+Ana']] }),
      b('h2', 'Tasks live inside notes too'),
      b('task', '', { ref: ideasTask.id }),
      b('quote', 'Small steps every day add up to big things.'),
      b('divider'),
      b('p', 'Select some text to format it, or to rewrite / summarize it with on-device AI ✨'),
    ],
  });
  create('note', {
    title: 'Weekly planning', folderId: work.id, icon: { type: 'emoji', value: '🗓️' }, tags: [focus.id],
    blocks: [b('h2', 'Goals this week'), b('ol', 'Ship the quarterly report'), b('ol', 'Prepare the product demo'), b('ol', 'Plan the offsite agenda'),
      b('h2', 'Notes'), b('p', 'Keep Wednesday afternoon free for deep work.'), b('h3', 'Open questions'), b('ul', 'Budget for the offsite?'), b('ul', 'Who presents the demo?', { level: 1 })],
  });
  create('note', {
    title: 'Side project ideas', folderId: side.id, icon: { type: 'emoji', value: '💡' }, tags: [idea.id], cover: { type: 'preset', id: 'aurora' },
    blocks: [b('p', 'A running list — nothing is too small.'), b('ul', 'Habit tracker for plants 🌱'), b('ul', 'Recipe planner that builds a grocery list'), b('ul', 'Tiny tool to split bills with friends'),
      b('code', 'const idea = { effort: "low", fun: "high" };')],
  });
  create('note', {
    title: 'Reading notes: The Creative Habit', tags: [reading.id], icon: { type: 'emoji', value: '📚' },
    blocks: [b('quote', 'Creativity is a habit, and the best creativity is the result of good work habits.'), b('p', 'Routines free up attention for the work itself.')],
  });
  setSetting('onboarded', true);
}
