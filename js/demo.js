/* demo.js — демонстрационные данные.
   Загружаются по кнопке в настройках, помечаются isDemo: true и удаляются одной кнопкой.
   В приложение не вшиты: без явного действия база остаётся пустой. */

import * as db from './db.js';
import * as M from './model.js';
import * as store from './store.js';

const CLASSES = ['5А', '6Б', '7В'];

const LAST_NAMES_M = ['Иванов','Петров','Смирнов','Кузнецов','Соколов','Попов','Лебедев','Козлов','Новиков','Морозов','Волков','Зайцев','Павлов','Семёнов','Голубев','Виноградов','Богданов','Воробьёв','Фёдоров','Михайлов','Беляев','Тарасов','Белов','Комаров','Орлов','Киселёв','Макаров','Андреев','Ковалёв','Ильин'];
const FIRST_NAMES_M = ['Иван','Пётр','Алексей','Дмитрий','Сергей','Андрей','Никита','Максим','Артём','Егор','Кирилл','Михаил','Роман','Владислав','Глеб','Тимур','Денис','Макар','Лев','Степан','Григорий','Виталий','Олег','Фёдор','Борис','Юрий','Илья','Матвей','Вадим','Антон'];
const LAST_NAMES_F = ['Смирнова','Иванова','Кузнецова','Попова','Соколова','Лебедева','Козлова','Новикова','Морозова','Петрова','Волкова','Соловьёва','Васильева','Зайцева','Павлова','Семёнова','Голубева','Виноградова','Богданова','Воробьёва','Фёдорова','Михайлова','Беляева','Тарасова','Белова','Комарова','Орлова','Киселёва','Макарова','Андреева'];
const FIRST_NAMES_F = ['Анна','Мария','Екатерина','Ольга','Татьяна','Дарья','Полина','Софья','Алиса','Виктория','Елена','Наталья','Ирина','Ксения','Вероника','Алина','Милана','Валерия','Юлия','Анастасия','Евгения','Кристина','Лилия','Маргарита','Светлана','Злата','Ева','Диана','Арина','Ульяна'];
const MIDDLE_M = ['Иванович','Петрович','Сергеевич','Алексеевич','Дмитриевич','Андреевич','Николаевич','Владимирович','Максимович','Олегович'];
const MIDDLE_F = ['Ивановна','Петровна','Сергеевна','Алексеевна','Дмитриевна','Андреевна','Николаевна','Владимировна','Максимовна','Олеговна'];

/** Детерминированный генератор — чтобы демо выглядело одинаково при каждом запуске. */
function makeRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const TOPICS = [
  'Инструктаж по технике безопасности на уроках лёгкой атлетики',
  'Бег на 30 м с высокого старта',
  'Бег на 60 м с низкого старта',
  'Челночный бег 3×10 м',
  'Прыжок в длину с места',
  'Прыжок в длину с разбега',
  'Метание мяча на дальность',
  'Метание мяча в цель',
  'Кроссовый бег 1000 м',
  'Подтягивание на перекладине',
  'Сгибание и разгибание рук в упоре лёжа',
  'Поднимание туловища из положения лёжа',
  'Наклон вперёд из положения стоя',
  'Инструктаж по технике безопасности на уроках гимнастики',
  'Кувырок вперёд',
  'Кувырок назад',
  'Стойка на лопатках',
  'Мост из положения лёжа',
  'Упражнения на гимнастической скамейке',
  'Лазание по гимнастической стенке',
  'Опорный прыжок через козла',
  'Висы и упоры на перекладине',
  'Акробатическая комбинация из изученных элементов',
  'Инструктаж по технике безопасности на уроках лыжной подготовки',
  'Попеременный двушажный ход',
  'Одновременный бесшажный ход',
  'Подъём «ёлочкой»',
  'Спуск со склона в основной стойке',
  'Торможение «плугом»',
  'Прохождение дистанции 1 км на лыжах',
  'Инструктаж по технике безопасности на уроках спортивных игр',
  'Ведение мяча правой и левой рукой',
  'Передача мяча двумя руками от груди',
  'Бросок мяча в кольцо с места',
  'Штрафной бросок',
  'Ведение мяча с изменением направления',
  'Верхняя передача мяча',
  'Нижняя подача мяча',
  'Приём мяча снизу двумя руками',
  'Учебная игра в пионербол',
  'Учебная игра в баскетбол',
  'Учебная игра в волейбол',
  'Подвижные игры с элементами спортивных игр',
  'Подведение итогов учебного года',
];

const EXEMPTION_REASONS = ['справка после ОРВИ', 'справка до конца месяца', 'подготовительная группа', 'справка после травмы', 'освобождён по заключению врача'];

/** Формирует ФИО по номеру — без повторов внутри класса. */
function makeName(rand, index, used) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const female = rand() > 0.52;
    const last = female
      ? LAST_NAMES_F[Math.floor(rand() * LAST_NAMES_F.length)]
      : LAST_NAMES_M[Math.floor(rand() * LAST_NAMES_M.length)];
    const first = female
      ? FIRST_NAMES_F[Math.floor(rand() * FIRST_NAMES_F.length)]
      : FIRST_NAMES_M[Math.floor(rand() * FIRST_NAMES_M.length)];
    const mid = female
      ? MIDDLE_F[Math.floor(rand() * MIDDLE_F.length)]
      : MIDDLE_M[Math.floor(rand() * MIDDLE_M.length)];
    // Склонение не моделируем — в журнале учителя ФИО пишут в именительном падеже.
    const full = `${last} ${first} ${mid}`;
    if (!used.has(full)) {
      used.add(full);
      return full;
    }
  }
  return `Ученик ${index}`;
}

/**
 * Генерирует даты уроков: 2 урока в неделю по расписанию,
 * начиная с даты старта учебного года, только будни.
 */
function lessonDates(yearFrom, yearTo) {
  const out = [];
  const start = M.parseIso(yearFrom);
  const end = M.parseIso(yearTo);
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    // Вторник (2) и четверг (4) — типовое расписание физкультуры.
    if (dow === 2 || dow === 4) out.push(M.iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Загружает демо-данные. Существующие классы не трогает.
 * @param {{wipeExisting?: boolean}} opts
 */
export async function seedDemo(opts = {}) {
  const settings = store.state.settings;
  const rand = makeRandom(20260901);
  const dates = lessonDates(settings.year.from, settings.year.to);

  const classes = [];
  const students = [];
  const lessons = [];
  const marks = [];
  const exemptions = [];
  const topics = [];
  const ktpList = [];
  const schedule = [];

  // --- КТП: один план на каждую параллель (5, 6, 7), привязан к классу ---
  CLASSES.forEach((name, ci) => {
    const ktpId = `demo_ktp_${ci + 1}`;
    ktpList.push({
      id: ktpId,
      name: `Физическая культура, ${name.slice(0, 1)} класс`,
      classIds: [`demo_cls_${ci + 1}`],
      isDemo: true,
    });
    TOPICS.forEach((topicName, i) => {
      topics.push({
        id: `demo_top_${ci + 1}_${i + 1}`,
        name: topicName,
        ktpOrder: i + 1,
        ktpId,
        isDemo: true,
      });
    });
  });

  // --- Расписание: каждый класс два раза в неделю ---
  CLASSES.forEach((name, ci) => {
    const classId = `demo_cls_${ci + 1}`;
    // 5А — пн/ср, 6Б — вт/чт, 7В — ср/пт
    const days = ci === 0 ? [1, 3] : ci === 1 ? [2, 4] : [3, 5];
    const slot = ci + 1;
    const times = ci === 0 ? ['09:00', '10:00'] : ci === 1 ? ['11:00', '12:00'] : ['13:00', '14:00'];
    days.forEach((weekday, i) => {
      schedule.push({
        id: `demo_sch_${ci + 1}_${i + 1}`,
        weekday,
        slot,
        classId,
        time: times[i],
        isDemo: true,
      });
    });
  });

  // --- классы и ученики ---
  CLASSES.forEach((name, ci) => {
    const classId = `demo_cls_${ci + 1}`;
    classes.push({ id: classId, name, isDemo: true });

    const used = new Set();
    for (let i = 0; i < 30; i++) {
      students.push({
        id: `demo_stu_${ci + 1}_${i + 1}`,
        classId,
        number: i + 1,
        fullName: makeName(rand, i, used),
        isDemo: true,
      });
    }
  });
  // --- уроки: до сегодняшнего дня включительно, но не больше 60 на класс ---
  const today = M.todayIso();
  const pastDates = dates.filter((d) => d <= today);
  const dateList = pastDates.length ? pastDates.slice(0, 60) : dates.slice(0, 12);

  classes.forEach((cls, ci) => {
    dateList.forEach((date, i) => {
      // Тема — из КТП именно этого класса
      const classTopics = topics.filter((t) => t.ktpId === `demo_ktp_${ci + 1}`);
      const topic = classTopics[i % classTopics.length];
      lessons.push({
        id: `demo_les_${ci + 1}_${i + 1}`,
        classId: cls.id,
        date,
        topicId: topic ? topic.id : null,
        note: '',
        isDemo: true,
      });
    });
  });

  // --- освобождения (несколько учеников) ---
  const exemptionPlan = [
    // [индекс класса, номер ученика, начало, длительность в днях или null]
    [0, 3, null, 14],
    [0, 17, null, null],
    [1, 8, null, 21],
    [2, 5, null, null],
    [2, 22, null, 10],
  ];

  exemptionPlan.forEach(([ci, num, _, len], idx) => {
    const cls = classes[ci];
    const studentId = `demo_stu_${ci + 1}_${num}`;
    const classLessons = lessons.filter((l) => l.classId === cls.id);
    // Начало — за 10 уроков до конца, чтобы диапазон выглядел правдоподобно.
    const anchor = classLessons[Math.max(0, classLessons.length - 8)] || classLessons[0];
    const from = anchor ? anchor.date : dates[0];
    const to = len === null ? null : M.addDays(from, len);
    exemptions.push({
      id: `demo_exm_${idx + 1}`,
      studentId,
      dateFrom: from,
      dateTo: to,
      reason: EXEMPTION_REASONS[idx % EXEMPTION_REASONS.length],
      createdAt: new Date().toISOString(),
      isDemo: true,
    });

    // auto-osv на уроки, попавшие в диапазон
    classLessons.forEach((lesson) => {
      if (lesson.date >= from && (to === null || lesson.date <= to)) {
        marks.push({
          id: `demo_mk_osv_${idx + 1}_${lesson.id}`,
          studentId,
          lessonId: lesson.id,
          value: null,
          flag: 'ОСВ',
          source: 'auto-osv',
          isDemo: true,
        });
      }
    });
  });

  // --- оценки и отметки посещаемости по прошедшим урокам ---
  const exemptByStudent = new Map();
  exemptions.forEach((ex) => exemptByStudent.set(ex.studentId, ex));

  classes.forEach((cls, ci) => {
    const classLessons = lessons.filter((l) => l.classId === cls.id);
    const classStudents = students.filter((s) => s.classId === cls.id);

    classStudents.forEach((st) => {
      // «Активность» ученика влияет на вероятность оценки.
      const diligence = 0.45 + rand() * 0.45;

      classLessons.forEach((lesson, li) => {
        const ex = exemptByStudent.get(st.id);
        const isExempt = ex && lesson.date >= ex.dateFrom && (ex.dateTo === null || lesson.date <= ex.dateTo);
        if (isExempt) return; // уже создали auto-osv выше

        const existing = marks.find((m) => m.lessonId === lesson.id && m.studentId === st.id);
        if (existing) return;

        const r = rand();
        if (r < 0.1) {
          // отсутствовал
          marks.push({
            id: `demo_mk_${ci}_${st.number}_${li}`,
            studentId: st.id,
            lessonId: lesson.id,
            value: null,
            flag: 'Н',
            source: 'manual',
            isDemo: true,
          });
        } else if (r < diligence) {
          // оценка: чаще 4–5, реже 3, совсем редко 2
          const roll = rand();
          const value = roll > 0.94 ? '2' : roll > 0.78 ? '3' : roll > 0.35 ? '4' : '5';
          marks.push({
            id: `demo_mk_${ci}_${st.number}_${li}`,
            studentId: st.id,
            lessonId: lesson.id,
            value,
            flag: null,
            source: 'manual',
            isDemo: true,
            ...(rand() > 0.85 ? { weight: 2 } : {}),
          });
        }
      });
    });
  });

  // --- запись ---
  if (opts.wipeExisting) {
    await db.clearAll();
  }
  await db.bulkPut('classes', classes);
  await db.bulkPut('students', students);
  await db.bulkPut('topics', topics);
  await db.bulkPut('ktp', ktpList);
  await db.bulkPut('schedule', schedule);
  await db.bulkPut('lessons', lessons);
  await db.bulkPut('marks', marks);
  await db.bulkPut('exemptions', exemptions);

  // настройки при первом запуске
  if (!(await db.get('meta', 'settings'))) {
    await db.put('meta', { ...store.state.settings, id: 'settings' });
  }

  await store.load();
  return { classes: classes.length, students: students.length, lessons: lessons.length, marks: marks.length };
}
