/* tools/prepare-snapshot.mjs — готовит статью для снимков: демо-данные встроены в скрипт.
   В headless-браузере IndexedDB не успевает за virtual-time, поэтому для снимков
   используем режим «без базы»: state заполняется прямо из этого файла.
   Запуск: node tools/prepare-snapshot.mjs */

import { writeFileSync } from 'node:fs';

// generate пока без DOM: demo.js зависит от store/Notify, поэтому собираем данные сами
import * as M from '../js/model.js';

/* Повторяем генератор demo.js, но чисто — без записи в базу. */
const CLASSES = ['5А', '6Б', '7В'];
const LAST_M = ['Иванов','Петров','Смирнов','Кузнецов','Соколов','Попов','Лебедев','Козлов','Новиков','Морозов','Волков','Зайцев','Павлов','Семёнов','Голубев','Виноградов','Богданов','Воробьёв','Фёдоров','Михайлов','Беляев','Тарасов','Белов','Комаров','Орлов','Киселёв','Макаров','Андреев','Ковалёв','Ильин'];
const F_M = ['Иван','Пётр','Алексей','Дмитрий','Сергей','Андрей','Никита','Максим','Артём','Егор','Кирилл','Михаил','Роман','Владислав','Глеб','Тимур','Денис','Макар','Лев','Степан','Григорий','Виталий','Олег','Фёдор','Борис','Юрий','Илья','Матвей','Вадим','Антон'];
const LAST_F = ['Смирнова','Иванова','Кузнецова','Попова','Соколова','Лебедева','Козлова','Новикова','Морозова','Петрова','Волкова','Соловьёва','Васильева','Зайцева','Павлова','Семёнова','Голубева','Виноградова','Богданова','Воробьёва','Фёдорова','Михайлова','Беляева','Тарасова','Белова','Комарова','Орлова','Киселёва','Макарова','Андреева'];
const F_F = ['Анна','Мария','Екатерина','Ольга','Татьяна','Дарья','Полина','Софья','Алиса','Виктория','Елена','Наталья','Ирина','Ксения','Вероника','Алина','Милана','Валерия','Юлия','Анастасия','Евгения','Кристина','Лилия','Маргарита','Светлана','Злата','Ева','Диана','Арина','Ульяна'];
const MID_M = ['Иванович','Петрович','Сергеевич','Алексеевич','Дмитриевич','Андреевич','Николаевич','Владимирович','Максимович','Олегович'];
const MID_F = ['Ивановна','Петровна','Сергеевна','Алексеевна','Дмитриевна','Андреевна','Николаевна','Владимировна','Максимовна','Олеговна'];

const TOPICS = [
  'Инструктаж по технике безопасности на уроках лёгкой атлетики','Бег на 30 м с высокого старта',
  'Бег на 60 м с низкого старта','Челночный бег 3×10 м','Прыжок в длину с места','Прыжок в длину с разбега',
  'Метание мяча на дальность','Метание мяча в цель','Кроссовый бег 1000 м','Подтягивание на перекладине',
  'Сгибание и разгибание рук в упоре лёжа','Поднимание туловища из положения лёжа','Наклон вперёд из положения стоя',
  'Инструктаж по технике безопасности на уроках гимнастики','Кувырок вперёд','Кувырок назад','Стойка на лопатках',
  'Мост из положения лёжа','Упражнения на гимнастической скамейке','Лазание по гимнастической стенке',
  'Опорный прыжок через козла','Висы и упоры на перекладине','Акробатическая комбинация из изученных элементов',
  'Инструктаж по технике безопасности на уроках лыжной подготовки','Попеременный двушажный ход','Одновременный бесшажный ход',
  'Подъём «ёлочкой»','Спуск со склона в основной стойке','Торможение «плугом»','Прохождение дистанции 1 км на лыжах',
  'Двухшажный попеременный ход','Коньковый ход без палок','Инструктаж по технике безопасности на уроках спортивных игр',
  'Ведение мяча правой и левой рукой','Передача мяча двумя руками от груди','Бросок мяча в кольцо с места','Штрафной бросок',
  'Ведение мяча с изменением направления','Верхняя передача мяча','Нижняя подача мяча','Приём мяча снизу двумя руками',
  'Учебная игра в пионербол','Учебная игра в баскетбол','Учебная игра в волейбол','Подведение итогов учебного года',
];

function makeRandom(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const rand = makeRandom(20260901);
const settings = M.defaultSettings();
const dateFrom = settings.year.from, dateTo = settings.year.to;

// Даты уроков: вторник и четверг
const dates = [];
{
  const d = M.parseIso(dateFrom), end = M.parseIso(dateTo);
  while (d <= end) {
    const dow = d.getDay();
    if (dow === 2 || dow === 4) dates.push(M.iso(d));
    d.setDate(d.getDate() + 1);
  }
}

const today = M.todayIso();
const past = dates.filter((x) => x <= today);
const dateList = past.length ? past.slice(0, 60) : dates.slice(0, 12);

const topics = TOPICS.map((name, i) => ({ id: `demo_top_${i + 1}`, name, ktpOrder: i + 1 }));
const classes = [];
const students = [];
const lessons = [];
const marks = [];
const exemptions = [];

CLASSES.forEach((name, ci) => {
  const classId = `demo_cls_${ci + 1}`;
  classes.push({ id: classId, name, isDemo: true });
  const used = new Set();
  for (let i = 0; i < 30; i++) {
    let full;
    for (let a = 0; a < 50; a++) {
      const female = rand() > 0.52;
      const l = female ? LAST_F[Math.floor(rand() * LAST_F.length)] : LAST_M[Math.floor(rand() * LAST_M.length)];
      const f = female ? F_F[Math.floor(rand() * F_F.length)] : F_M[Math.floor(rand() * F_M.length)];
      const m = female ? MID_F[Math.floor(rand() * MID_F.length)] : MID_M[Math.floor(rand() * MID_M.length)];
      full = `${l} ${f} ${m}`;
      if (!used.has(full)) break;
    }
    used.add(full);
    students.push({ id: `demo_stu_${ci + 1}_${i + 1}`, classId, number: i + 1, fullName: full, isDemo: true });
  }
});

classes.forEach((cls, ci) => {
  dateList.forEach((date, i) => {
    const topic = topics[(i + ci * 3) % topics.length];
    lessons.push({ id: `demo_les_${ci + 1}_${i + 1}`, classId: cls.id, date, topicId: topic.id, note: '', isDemo: true });
  });
});

// Освобождения
[[0, 3, 14], [0, 17, null], [1, 8, 21], [2, 5, null], [2, 22, 10]].forEach(([ci, num, len], idx) => {
  const classId = classes[ci].id;
  const studentId = `demo_stu_${ci + 1}_${num}`;
  const ls = lessons.filter((l) => l.classId === classId);
  const anchor = ls[Math.max(0, ls.length - 8)] || ls[0];
  const from = anchor ? anchor.date : dates[0];
  const to = len === null ? null : M.addDays(from, len);
  exemptions.push({ id: `demo_exm_${idx + 1}`, studentId, dateFrom: from, dateTo: to, reason: 'справка после ОРВИ', createdAt: new Date().toISOString(), isDemo: true });
  ls.forEach((lesson) => {
    if (lesson.date >= from && (to === null || lesson.date <= to)) {
      marks.push({ id: `demo_mk_osv_${idx}_${lesson.id}`, studentId, lessonId: lesson.id, value: null, flag: 'ОСВ', source: 'auto-osv', isDemo: true });
    }
  });
});

const exMap = new Map(exemptions.map((e) => [e.studentId, e]));

classes.forEach((cls, ci) => {
  const ls = lessons.filter((l) => l.classId === cls.id);
  const ss = students.filter((s) => s.classId === cls.id);
  ss.forEach((st) => {
    const diligence = 0.45 + rand() * 0.45;
    ls.forEach((lesson, li) => {
      const ex = exMap.get(st.id);
      if (ex && lesson.date >= ex.dateFrom && (ex.dateTo === null || lesson.date <= ex.dateTo)) return;
      const r = rand();
      if (r < 0.1) {
        marks.push({ id: `demo_mk_${ci}_${st.number}_${li}`, studentId: st.id, lessonId: lesson.id, value: null, flag: 'Н', source: 'manual', isDemo: true });
      } else if (r < diligence) {
        const roll = rand();
        const value = roll > 0.94 ? '2' : roll > 0.78 ? '3' : roll > 0.35 ? '4' : '5';
        marks.push({ id: `demo_mk_${ci}_${st.number}_${li}`, studentId: st.id, lessonId: lesson.id, value, flag: null, source: 'manual', isDemo: true });
      }
    });
  });
});

const dump = { meta: [settings], classes, students, topics, lessons, marks, exemptions, monthly: [] };
writeFileSync('shots/seed.json', JSON.stringify(dump));
console.log('classes', classes.length, 'students', students.length, 'lessons', lessons.length, 'marks', marks.length);
