'use strict';
/**
 * Inner page copy + shared lists (FAQ, fleet, guests) for RU / EN / KY.
 */
const fleet = [
  {
    key: 'h125', name: 'Airbus H125', image: 'h125-06', reg: 'EX-88010', model3d: true, gallery: ['h125-06', 'h125-01', 'h125-02', 'h125-04', 'h125-05', 'h125-03'],
    specs: { seats: '4', cruise: 235, range: 691, ceiling: 7010, year: 2022 },
    t: {
      ru: { role: 'Основной борт горных маршрутов', desc: 'Лёгкий одномоторный вертолёт, рекордсмен по высотности: именно H125 садился на вершину Эвереста. Четыре пассажирских места, панорамные окна.' },
      en: { role: 'The main aircraft for mountain routes', desc: 'A light single-engine helicopter and the altitude record holder: an H125 landed on the summit of Everest. Four passenger seats, panoramic windows.' },
      ky: { role: 'Тоо багыттарынын негизги борту', desc: 'Жеңил бир кыймылдаткычтуу вертолёт, бийиктик боюнча рекордсмен: дал ушул H125 Эверестин чокусуна конгон. Төрт жүргүнчү орду, панорамалык терезелер.' },
    },
  },
  {
    key: 'h145', name: 'Airbus H145', image: 'h145-01', gallery: ['h145-01', 'h145-05', 'h145-02', 'h145-03', 'h145-04', 'h145-06'],
    specs: { seats: '6–8', cruise: 248, range: null, ceiling: null, year: 2022 },
    t: {
      ru: { role: 'Двухдвигательный', desc: 'VIP-перевозки, медицинская эвакуация, поисково-спасательные работы. От 6 до 8 мест в зависимости от компоновки салона.' },
      en: { role: 'Twin-engine', desc: 'VIP transport, medical evacuation, search and rescue. From 6 to 8 seats depending on the cabin layout.' },
      ky: { role: 'Эки кыймылдаткычтуу', desc: 'VIP-ташуу, медициналык эвакуация, издөө-куткаруу иштери. Салондун жайгашуусуна жараша 6дан 8ге чейин орун.' },
    },
  },
  {
    key: 'mi8', name: 'Ми-8', image: 'mi8-01', gallery: ['mi8-01'],
    specs: { seats: '20+', cruise: 225, range: null, ceiling: null, year: 2023 },
    t: {
      ru: { role: 'Тяжёлый борт', desc: 'Для больших групп, грузов и работ в высокогорье. Экспедиции, съёмочные группы, оборудование.' },
      en: { role: 'Heavy-lift', desc: 'For large groups, cargo and high-altitude operations. Expeditions, film crews, equipment.' },
      ky: { role: 'Оор борт', desc: 'Чоң топтор, жүктөр жана бийик тоодогу иштер үчүн. Экспедициялар, тартуу топтору, жабдуулар.' },
    },
  },
];

const guests = [
  { image: 'guest-01', name: { ru: 'Оскар Хартманн', en: 'Oskar Hartmann', ky: 'Оскар Хартманн' }, role: { ru: 'Предприниматель и международный инвестор, основатель KupiVIP и инвестор более 150 компаний.', en: 'Entrepreneur and international investor, founder of KupiVIP and an investor in more than 150 companies.', ky: 'Ишкер жана эл аралык инвестор, KupiVIP негиздөөчүсү жана 150дөн ашык компаниянын инвестору.' } },
  { image: 'guest-02', name: { ru: 'Айжан Аденова', en: 'Aizhan Adenova', ky: 'Айжан Аденова' }, role: { ru: 'Кыргызстан · актриса, модель, блогер', en: 'Kyrgyzstan · actress, model, blogger', ky: 'Кыргызстан · актриса, модель, блогер' } },
  { image: 'guest-03', name: { ru: 'Мадинахон Мамадалиева', en: 'Madinakhon Mamadalieva', ky: 'Мадинахон Мамадалиева' }, role: { ru: 'Блогер, предприниматель', en: 'Blogger, entrepreneur', ky: 'Блогер, ишкер' } },
  { image: 'guest-04', name: { ru: 'Мэри Кувакова', en: 'Mary Kuvakova', ky: 'Мэри Кувакова' }, role: { ru: 'Модель, «Мисс Кыргызстан 2025». Представляла Кыргызстан на конкурсе «Мисс Вселенная 2025».', en: 'Model, Miss Kyrgyzstan 2025. Represented Kyrgyzstan at Miss Universe 2025.', ky: 'Модель, «Мисс Кыргызстан 2025». Кыргызстанды «Мисс Вселенная 2025» сынагында көрсөткөн.' } },
  { image: 'guest-05', name: { ru: 'Чолпон Уламбекова', en: 'Cholpon Ulambekova', ky: 'Чолпон Уламбекова' }, role: { ru: 'Маркетолог, телеведущая, блогер и предпринимательница.', en: 'Marketing specialist, TV presenter, blogger and entrepreneur.', ky: 'Маркетолог, телеалып баруучу, блогер жана ишкер.' } },
  { image: 'guest-06', name: { ru: 'Гузи Исламова', en: 'Guzi Islamova', ky: 'Гузи Исламова' }, role: { ru: 'Модель и тревел-блогер.', en: 'Model and travel blogger.', ky: 'Модель жана саякат блогери.' } },
  { image: 'guest-07', name: { ru: 'Аня Бонито', en: 'Anya Bonito', ky: 'Аня Бонито' }, role: { ru: 'Предпринимательница, основательница бренда Bonito.', en: 'Entrepreneur, founder of the Bonito brand.', ky: 'Ишкер, Bonito брендинин негиздөөчүсү.' } },
  { image: 'guest-08', name: { ru: 'Океана Урматбек', en: 'Okeana Urmatbek', ky: 'Океана Урматбек' }, role: { ru: 'Актриса и блогер. Известна по ролям в кыргызстанских кино- и телепроектах.', en: 'Actress and blogger, known for her roles in Kyrgyz film and television.', ky: 'Актриса жана блогер. Кыргызстандын кино жана телепроекттериндеги ролдору менен белгилүү.' } },
  { image: 'guest-09', name: { ru: 'Сабина Мамадалиева', en: 'Sabina Mamadalieva', ky: 'Сабина Мамадалиева' }, role: { ru: 'Блогер и предпринимательница, создательница проектов в сфере моды.', en: 'Blogger and entrepreneur, creator of her own fashion projects.', ky: 'Блогер жана ишкер, мода тармагындагы долбоорлордун автору.' } },
  { image: 'guest-10', name: { ru: 'Акылай Калбердиева', en: 'Akylai Kalberdieva', ky: 'Акылай Калбердиева' }, role: { ru: 'Модель, «Мисс Кыргызстан 2023», представляла Кыргызстан на Miss Universe 2023.', en: 'Model, Miss Kyrgyzstan 2023, represented Kyrgyzstan at Miss Universe 2023.', ky: 'Модель, «Мисс Кыргызстан 2023», Кыргызстанды Miss Universe 2023 сынагында көрсөткөн.' } },
  { image: 'guest-11', name: { ru: 'Акылай Саитова', en: 'Akylai Saitova', ky: 'Акылай Саитова' }, role: { ru: 'Блогер', en: 'Blogger', ky: 'Блогер' } },
  { image: 'guest-12', name: { ru: 'Азирет Осмонов', en: 'Aziret Osmonov', ky: 'Азирет Осмонов' }, role: { ru: 'Журналист, блогер и телеведущий.', en: 'Journalist, blogger and TV presenter.', ky: 'Журналист, блогер жана телеалып баруучу.' } },
  { image: 'guest-13', name: { ru: 'Ким Станислав', en: 'Kim Stanislav', ky: 'Ким Станислав' }, role: { ru: 'Гость HeliHop', en: 'HeliHop guest', ky: 'HeliHop коногу' } },
];

const faq = {
  ru: [
    { q: 'Как проходит бронирование?', a: 'Сначала согласуем маршрут. Потом подбираем дату — она зависит от занятости борта и от погоды. После этого вы вносите предоплату, и мы ставим бронь на это время.' },
    { q: 'Что будет, если погода нелётная?', a: 'Решение принимает не менеджер, а лётная служба и диспетчерская. Если они говорят, что погода нелётная, полёт переносится — подбираем удобную для вас дату. Если ни одна дата не подходит, возвращаем предоплату в полном размере.' },
    { q: 'По каким ещё причинам полёт могут перенести?', a: 'Всего таких причин три, и все они про безопасность, а не про наше удобство.<br>1. Погода — решают лётная служба и диспетчерская.<br>2. Техника — осмотр проводится перед каждым полётом и после него. Если выявлены неполадки или нужны внеплановые работы, полёт переносится.<br>3. Государственные вылеты — воздушное пространство закрывают под спецрейсы, чрезвычайные ситуации и визиты делегаций.<br>Во всех трёх случаях действуем одинаково: переносим на удобную дату или возвращаем предоплату.' },
    { q: 'Входит ли фотограф в стоимость?', a: 'После полёта — да. Наш фотограф работает с вами 5–10 минут и отдаёт 10–20 готовых кадров. Это кадры на память, и они входят в стоимость полёта.<br>Полноценная съёмка — это отдельная услуга: она для брендов, модельных агентств, Love Story и свадеб. Её можно заказать и без полёта.' },
    { q: 'Нужна ли предоплата?', a: 'Да. Бронь на конкретное время ставим после предоплаты — до этого дата остаётся свободной для других гостей. Если полёт переносим мы, предоплата сохраняется или возвращается полностью.' },
    { q: 'Можно снимать вертолёт без полёта?', a: 'Да, это отдельная услуга. Вертолёт стоит на площадке с выключенными двигателями, снимать можно снаружи и в салоне. До 10 человек, от одного до двух часов — стоимость при этом одна.<br>Airbus H125 — 30 000 сом, Airbus H145 — 35 000 сом. В будний день, съёмку заканчиваем до 17:00. В выходные — доплата 50% к стоимости каждого борта.' },
    { q: 'Что взять с собой?', a: 'Для маршрутов с посадкой в горах — тёплую одежду и солнцезащитные очки: на 3 500 м прохладно даже летом. Паспорт обязателен: данные пассажиров передаются заранее. Телефон и камеру берите смело — снимать в полёте можно.' },
    { q: 'Насколько это безопасно?', a: 'Летаем на вертолётах Airbus 2022 года. У каждого пилота более 20 лет опыта в авиации и налёт от 8 000 часов, медосмотр каждые 6 месяцев, тренировки на симуляторах. Перед каждым вылетом — брифинг и инструктаж.' },
  ],
  en: [
    { q: 'How does booking work?', a: 'First we agree on the route. Then we choose a date — it depends on the aircraft schedule and the weather. After that you make a prepayment and we hold the slot for you.' },
    { q: 'What if the weather is not flyable?', a: 'The decision is made by the flight operations service and air traffic control, not by a manager. If they say the weather is not flyable, the flight is rescheduled to a date convenient for you. If no date works, we refund the prepayment in full.' },
    { q: 'What else can postpone a flight?', a: 'There are three reasons in total, and all of them are about safety, not our convenience.<br>1. Weather — decided by flight operations and air traffic control.<br>2. Technical — the aircraft is inspected before and after every flight. If an issue is found or unscheduled maintenance is needed, the flight is rescheduled.<br>3. State flights — the airspace is closed for special flights, emergencies and delegation visits.<br>In all three cases we act the same way: reschedule to a convenient date or refund the prepayment.' },
    { q: 'Is a photographer included?', a: 'After the flight — yes. Our photographer works with you for 5–10 minutes and delivers 10–20 edited shots. These are keepsake photos and they are included in the price.<br>A full photo shoot is a separate service: for brands, model agencies, Love Story and weddings. It can be booked without a flight.' },
    { q: 'Is a prepayment required?', a: 'Yes. We hold a specific time only after prepayment — until then the date stays open for other guests. If we reschedule the flight, the prepayment is kept or fully refunded.' },
    { q: 'Can I shoot the helicopter without flying?', a: 'Yes, it is a separate service. The helicopter stands on the pad with engines off; you can shoot outside and inside the cabin. Up to 10 people, one to two hours — the price is the same.<br>Airbus H125 — 30,000 KGS, Airbus H145 — 35,000 KGS. On weekdays, shoots end by 17:00. At weekends there is a 50% surcharge per aircraft.' },
    { q: 'What should I bring?', a: 'For routes with a mountain landing — warm clothes and sunglasses: at 3,500 m it is cool even in summer. A passport is required: passenger details are submitted in advance. Bring your phone and camera — filming in flight is allowed.' },
    { q: 'How safe is it?', a: 'We fly 2022 Airbus helicopters. Every pilot has more than 20 years in aviation and 8,000+ flight hours, a medical check every 6 months and simulator training. Before every flight — a briefing and safety instruction.' },
  ],
  ky: [
    { q: 'Брондоо кантип өтөт?', a: 'Адегенде багытты макулдашабыз. Андан кийин күндү тандайбыз — ал борттун бош убактысына жана аба ырайына жараша болот. Андан соң сиз алдын ала төлөм жасайсыз, биз ошол убакытка бронь коёбуз.' },
    { q: 'Аба ырайы учууга ылайыксыз болсо эмне болот?', a: 'Чечимди менеджер эмес, учуу кызматы жана диспетчерлик кабыл алат. Эгер алар аба ырайы учууга ылайыксыз десе, учуу которулат — сизге ыңгайлуу күндү тандайбыз. Эч бир күн туура келбесе, алдын ала төлөмдү толугу менен кайтарабыз.' },
    { q: 'Учуу дагы кандай себептерден которулушу мүмкүн?', a: 'Мындай себептер үчөө, жана бардыгы биздин ыңгайыбыз үчүн эмес, коопсуздук үчүн.<br>1. Аба ырайы — учуу кызматы жана диспетчерлик чечет.<br>2. Техника — ар бир учуудан мурун жана кийин текшерүү жүргүзүлөт. Көйгөй табылса же пландан тышкары иштер керек болсо, учуу которулат.<br>3. Мамлекеттик учуулар — аба мейкиндиги атайын рейстер, өзгөчө кырдаалдар жана делегациялардын сапарлары үчүн жабылат.<br>Үч учурда тең бирдей иш кылабыз: ыңгайлуу күнгө которобуз же алдын ала төлөмдү кайтарабыз.' },
    { q: 'Сүрөтчү баага киреби?', a: 'Учуудан кийин — ооба. Биздин сүрөтчү сиз менен 5–10 мүнөт иштеп, 10–20 даяр кадр берет. Бул эстелик кадрлар, алар учуунун баасына кирет.<br>Толук кандуу тартуу — өзүнчө кызмат: бренддер, модель агенттиктери, Love Story жана үлпөт тойлор үчүн. Аны учуусуз да буюртма кылса болот.' },
    { q: 'Алдын ала төлөм керекпи?', a: 'Ооба. Белгилүү убакытка броньду алдын ала төлөмдөн кийин коёбуз — ага чейин күн башка коноктор үчүн бош бойдон калат. Эгер учууну биз которсок, алдын ала төлөм сакталат же толугу менен кайтарылат.' },
    { q: 'Вертолётту учуусуз тартса болобу?', a: 'Ооба, бул өзүнчө кызмат. Вертолёт аянтчада кыймылдаткычтары өчүк турат, сыртынан жана салонунда тартса болот. 10 адамга чейин, бир сааттан эки саатка чейин — баасы бирдей.<br>Airbus H125 — 30 000 сом, Airbus H145 — 35 000 сом. Жумуш күндөрү тартууну 17:00гө чейин бүтүрөбүз. Дем алыш күндөрү — ар бир борттун баасына 50% кошумча төлөм.' },
    { q: 'Өзүм менен эмне алышым керек?', a: 'Тоого конуу менен багыттар үчүн — жылуу кийим жана күндөн коргоочу көз айнек: 3 500 мде жайында да салкын. Паспорт милдеттүү: жүргүнчүлөрдүн маалыматы алдын ала берилет. Телефон менен камераны алыңыз — учууда тартууга болот.' },
    { q: 'Бул канчалык коопсуз?', a: '2022-жылкы Airbus вертолёттору менен учабыз. Ар бир пилоттун авиацияда 20 жылдан ашык тажрыйбасы жана 8 000 сааттан ашык учуусу бар, ар 6 айда медициналык текшерүү, симуляторлордо машыгуу. Ар бир учуудан мурун — брифинг жана инструктаж.' },
  ],
};

const pages = {
  ru: {
    routes: {
      title: 'Вертолётные маршруты по Кыргызстану', metaTitle: 'Вертолётные маршруты по Кыргызстану — HeliHop Travel',
      sub: 'От первого короткого полёта до высокогорных маршрутов к ледникам и озёрам.',
      compare: 'Сравнить маршруты', compareCols: ['Маршрут', 'Полёт', 'На земле', 'Посадка', 'У окна', 'Среднее', 'Весь борт'],
      customTitle: 'Свой маршрут', customSub: 'Не нашли нужного маршрута? Создадим его под вас — летаем по всему Кыргызстану.',
    },
    route: {
      all: 'Все маршруты', price: 'Стоимость', chooseSeat: 'Выберите место', seatNote: 'Места у окна дороже — обзор лучше. Можно взять одно место, а можно выкупить борт целиком.', bookSeat: 'Забронировать место', wantWhole: 'Хочу весь борт', window: 'у окна', middle: 'среднее', pilot: 'пилот', selected: 'Выбрано', wholeNote: 'Этот маршрут мы отдаём только целиком — без попутчиков. До 4 человек.', bookWhole: 'Забронировать борт',
      expect: 'Что вас ждёт', photos: 'Фотографии', scheme: 'Схема маршрута', profile: 'Профиль высоты', aircraft: 'Борт', ready: 'Готовы лететь?', readySub: 'Напишите — подберём дату и ответим на вопросы.', other: 'Другие маршруты', highlights: 'Главное', tapSeat: 'Нажмите на кресло, чтобы выбрать', cabin: 'Салон Airbus H125 · вид сверху',
    },
    proposal: {
      metaTitle: 'Предложение руки и сердца на вертолёте — HeliHop Travel', label: 'Наша специализация', title: 'Она запомнит это на всю жизнь',
      intro: 'За всё время мы организовали больше сотни предложений руки и сердца. Знаем, где сядет вертолёт, куда встанет фотограф и что делать, если она заплачет.', cta: 'Обсудить сценарий',
      formatsLabel: 'Три формата', formatsTitle: 'Выберите сценарий', formatsSub: 'Отличаются не ценой, а тем, кто это увидит: только вы двое, вы и горы или вы и все гости.',
      scenarios: [
        { meta: 'Полёт 30 минут, 2 места', title: 'Во время полёта', desc: 'Предложение в воздухе, с панорамой гор за стеклом', price: 'от 71 000 сом', image: 'mm-01' },
        { meta: 'Полёт 1 час + посадка до 30 минут', title: 'С посадкой в горах', desc: 'Только вы двое — без шума и без свидетелей', price: 'от 131 000 сом', image: 'mm-02' },
        { meta: 'Полёт 30 минут, полный борт', title: 'С оформлением', desc: 'Декор, холодные фонтаны, фотозона — и вертолёт на площадке', price: 'от 135 000 сом', image: 'mm-03' },
      ],
      howLabel: 'Как это было', howTitle: 'Кадры с настоящих предложений', howSub: 'Публикуем только с согласия пары.',
      stepsLabel: 'Как это устроено', stepsTitle: 'Четыре шага',
      steps: [
        { title: 'Выбор формата', desc: 'Обсуждаем, какой сценарий ей подойдёт. Здесь важны детали: боится ли высоты, любит ли внимание.' },
        { title: 'Подбор даты и локации', desc: 'Смотрим погоду и световое окно. Закат — самый сильный кадр, но и самый капризный.' },
        { title: 'Согласование сценария', desc: 'Кто где стоит, в какой момент вы достаёте кольцо, где будет камера.' },
        { title: 'Подготовка и вылет', desc: 'Инструктаж, декор на локации, координатор рядом весь день.' },
      ],
      trustLabel: 'Почему нам это доверяют', trustTitle: 'Организация', trust: ['Лицензированные пилоты', 'Полная конфиденциальность — узнает только она', 'Предполётный инструктаж', 'Персональный координатор на весь день'],
      finalTitle: 'Расскажите, какая она', finalSub: 'И мы предложим сценарий. Без обязательств и без предоплаты за разговор.',
    },
    experiences: {
      metaTitle: 'Впечатления и съёмка — HeliHop Travel', label: 'Съёмка', title: 'Впечатления остаются. Кадры — тоже.',
      intro: 'Это две разные вещи. Кадры после полёта входят в стоимость. Съёмка без полёта — отдельная услуга со своей ценой.',
      afterLabel: 'Без доплат', afterTitle: 'Кадры после полёта', afterDesc: 'После посадки с вами работает наш фотограф: 5–10 минут, 10–20 готовых кадров. Это кадры на память, они входят в стоимость полёта.',
      shootLabel: 'Стоимость', shootTitle: 'Съёмка без полёта', shootDesc: 'Вертолёт стоит на площадке с выключенными двигателями. Можно снимать снаружи и внутри салона — столько, сколько нужно по сценарию.',
      prices: [{ name: 'Airbus H125', price: '30 000 сом' }, { name: 'Airbus H145', price: '35 000 сом' }], priceNote: 'Цена одна и за один час, и за два.', cta: 'Забронировать съёмку',
      galleryLabel: 'Наши кадры', galleryTitle: 'С высоты и с площадки',
      forLabel: 'Для кого', forItems: ['Бренды одежды и рекламные съёмки', 'Модельные агентства', 'Love Story', 'Свадебные фотосессии'],
      inLabel: 'Входит', inItems: ['Вертолёт на площадке с выключенными двигателями', 'Съёмка снаружи и внутри салона', 'До 10 человек в группе', 'Один автомобиль на площадке'],
      outLabel: 'Не входит', outItems: ['Второй автомобиль — за отдельную плату', '11-й человек и далее — за отдельную плату', 'Работа фотографа и оборудование'],
      condLabel: 'Условия', condItems: ['Длительность 1–2 часа — стоимость одна', 'Будние дни, съёмку заканчиваем до 17:00', 'В выходные — доплата 50% к стоимости каждого борта'],
    },
    gift: {
      metaTitle: 'Подарочный сертификат — HeliHop Travel', label: 'Подарок', title: 'Подарок, который запомнят', intro: 'Когда повод есть, а угадать с датой сложно. Получатель выберет день сам.',
      howTitle: 'Как оформить', steps: ['Выбрать маршрут', 'Выбрать посадочное место', 'Передать данные пассажира'], note: 'Сертификат нужно активировать в течение двух месяцев с даты покупки.', cta: 'Купить сертификат', all: 'Все маршруты',
      cardTitle: 'Подарочный сертификат', cardSub: 'Полёт над Тянь-Шанем', cardFor: 'Для', cardName: 'Имени получателя', cardValid: 'Действителен 2 месяца', cardHint: 'Наведите или наклоните телефон',
    },
    guests: { metaTitle: 'С нами летали — HeliHop Travel', label: 'Гости', title: 'С нами летали', sub: 'Публикуем только с личного согласия.' },
    partners: {
      metaTitle: 'Партнёрам — HeliHop Travel', label: 'Партнёрам', title: 'Создавайте больше впечатлений для своих гостей',
      intro: 'HeliHop помогает отелям, гидам, туроператорам и корпоративным клиентам добавлять вертолётные впечатления в свои предложения.',
      withLabel: 'С нами работают', partners: [{ name: 'Remote Hotel', type: 'отель' }, { name: 'Bakai Bank', type: 'банк' }, { name: 'Hyundai Center Kyrgyzstan', type: 'автоцентр' }, { name: 'Sofia Hotel', type: 'отель' }], withNote: 'Список пополняется.',
      whoLabel: 'Кому подходит', who: [
        { title: 'Отели и курорты', desc: 'вертолётные впечатления в предложении для гостей' },
        { title: 'Гиды и туроператоры', desc: 'эксклюзивные перелёты в маршрутах клиентов' },
        { title: 'DMC и concierge', desc: 'авиационный партнёр для VIP-гостей' },
        { title: 'Корпоративные клиенты', desc: 'private events и incentive-программы' },
        { title: 'Event и wedding', desc: 'предложения, съёмки и private experiences' },
      ],
      howLabel: 'Как начинаем', how: ['Заявка в WhatsApp', 'Обсуждаем формат сотрудничества', 'Согласовываем условия и материалы', 'Первое бронирование'], cta: 'Стать партнёром',
    },
    aviation: {
      metaTitle: 'Авиационные услуги — HeliHop Travel', label: 'HeliHop для бизнеса', title: 'HeliHop для бизнеса и специальных задач', intro: 'Выполняем авиационные работы по запросу.',
      services: ['VIP-перелёты', 'Индивидуальные чартеры', 'Корпоративные мероприятия', 'Аэрофото- и видеосъёмка', 'Геодезические и инженерные работы', 'Мониторинг и инспекция объектов', 'Медицинская авиация', 'Поисково-спасательные операции', 'Грузовые перевозки', 'Государственные и специальные задания'],
      cta: 'Обсудить задачу',
    },
    about: {
      metaTitle: 'О HeliHop — вертолёты и безопасность', label: 'Вертолёты', title: 'Вертолёты и безопасность', intro: 'Три борта. Под задачу подбираем борт, а не задачу под борт.', ask: 'Спросить про борт',
      pilotsLabel: 'Кто за штурвалом', pilotsTitle: 'Безопасность',
      safety: ['Более 20 лет опыта в авиации у каждого пилота', 'Налёт от 8 000 часов', 'Медосмотр каждые 6 месяцев — включая психологический', 'Повышение квалификации в Европе', 'Тренировки на симуляторах в ОАЭ', 'Полная конфиденциальность'],
      flowLabel: 'Как проходит полёт', flowTitle: 'От заявки до посадки',
      flow: [
        { title: 'Заявка и дата', desc: 'Согласуем маршрут и подбираем день по погоде и занятости борта.' },
        { title: 'Предоплата и бронь', desc: 'После предоплаты время закреплено за вами.' },
        { title: 'Брифинг и инструктаж', desc: 'На площадке — короткий брифинг, правила безопасности, посадка в вертолёт.' },
        { title: 'Полёт', desc: 'Панорамные окна, наушники с связью с пилотом, посадка в горах — если она есть в маршруте.' },
        { title: 'Фотограф', desc: 'После посадки 5–10 минут съёмки и 10–20 кадров на память.' },
      ],
    },
    credits: { metaTitle: 'Фотографии и лицензии — HeliHop Travel', title: 'Фотографии и лицензии', intro: 'Все фотографии на сайте — из полётов HeliHop Travel, публикуются с согласия гостей. © HeliHop Travel. Ниже — шрифты, библиотеки и данные, которые используются на сайте.' },
  },

  en: {
    routes: {
      title: 'Helicopter routes across Kyrgyzstan', metaTitle: 'Helicopter routes across Kyrgyzstan — HeliHop Travel',
      sub: 'From a first short flight to high-altitude routes to glaciers and lakes.',
      compare: 'Compare routes', compareCols: ['Route', 'Flight', 'On the ground', 'Landing', 'Window', 'Middle', 'Whole aircraft'],
      customTitle: 'Your own route', customSub: 'No route that fits? We will build one for you — we fly all over Kyrgyzstan.',
    },
    route: {
      all: 'All routes', price: 'Price', chooseSeat: 'Choose your seat', seatNote: 'Window seats cost more — the view is better. Take one seat or book the whole aircraft.', bookSeat: 'Book a seat', wantWhole: 'I want the whole aircraft', window: 'window', middle: 'middle', pilot: 'pilot', selected: 'Selected', wholeNote: 'We offer this route only as a whole aircraft — no fellow passengers. Up to 4 people.', bookWhole: 'Book the aircraft',
      expect: 'What to expect', photos: 'Photographs', scheme: 'Route map', profile: 'Altitude profile', aircraft: 'Aircraft', ready: 'Ready to fly?', readySub: 'Write to us — we will find a date and answer your questions.', other: 'Other routes', highlights: 'Highlights', tapSeat: 'Tap a seat to select it', cabin: 'Airbus H125 cabin · top view',
    },
    proposal: {
      metaTitle: 'Helicopter marriage proposal — HeliHop Travel', label: 'Our speciality', title: 'She will remember it for life',
      intro: 'Over the years we have organised more than a hundred marriage proposals. We know where the helicopter lands, where the photographer stands and what to do if she cries.', cta: 'Discuss a scenario',
      formatsLabel: 'Three formats', formatsTitle: 'Choose a scenario', formatsSub: 'They differ not in price but in who sees it: just the two of you, you and the mountains, or you and all the guests.',
      scenarios: [
        { meta: '30-minute flight, 2 seats', title: 'During the flight', desc: 'A proposal in the air with a mountain panorama behind the glass', price: 'from 71,000 KGS', image: 'mm-01' },
        { meta: '1-hour flight + landing up to 30 minutes', title: 'With a mountain landing', desc: 'Just the two of you — no noise and no witnesses', price: 'from 131,000 KGS', image: 'mm-02' },
        { meta: '30-minute flight, whole aircraft', title: 'With full décor', desc: 'Decorations, cold fountains, a photo zone — and the helicopter on the pad', price: 'from 135,000 KGS', image: 'mm-03' },
      ],
      howLabel: 'How it went', howTitle: 'Photos from real proposals', howSub: 'Published only with the couple\'s consent.',
      stepsLabel: 'How it works', stepsTitle: 'Four steps',
      steps: [
        { title: 'Choosing the format', desc: 'We discuss which scenario suits her. Details matter here: is she afraid of heights, does she like attention.' },
        { title: 'Date and location', desc: 'We check the weather and the light window. Sunset is the strongest shot — and the most capricious.' },
        { title: 'Agreeing the scenario', desc: 'Who stands where, when you take out the ring, where the camera will be.' },
        { title: 'Preparation and take-off', desc: 'Safety briefing, décor on location, a coordinator by your side all day.' },
      ],
      trustLabel: 'Why people trust us', trustTitle: 'Organisation', trust: ['Licensed pilots', 'Full confidentiality — only she will find out', 'Pre-flight safety instruction', 'Personal coordinator for the whole day'],
      finalTitle: 'Tell us about her', finalSub: 'And we will suggest a scenario. No obligations and no prepayment for a conversation.',
    },
    experiences: {
      metaTitle: 'Experiences and photo shoots — HeliHop Travel', label: 'Photo shoot', title: 'The experience stays. So do the photographs.',
      intro: 'These are two different things. Photos after the flight are included in the price. A shoot without a flight is a separate service with its own price.',
      afterLabel: 'No extra charge', afterTitle: 'Photos after the flight', afterDesc: 'After landing, our photographer works with you: 5–10 minutes, 10–20 edited shots. These are keepsake photos, included in the price of the flight.',
      shootLabel: 'Price', shootTitle: 'Shoot without a flight', shootDesc: 'The helicopter stands on the pad with engines off. You can shoot outside and inside the cabin — for as long as the script needs.',
      prices: [{ name: 'Airbus H125', price: '30,000 KGS' }, { name: 'Airbus H145', price: '35,000 KGS' }], priceNote: 'One price for one hour or two.', cta: 'Book a shoot',
      galleryLabel: 'Our shots', galleryTitle: 'From the air and from the pad',
      forLabel: 'Who it is for', forItems: ['Clothing brands and advertising shoots', 'Model agencies', 'Love Story', 'Wedding photo sessions'],
      inLabel: 'Included', inItems: ['Helicopter on the pad with engines off', 'Shooting outside and inside the cabin', 'Up to 10 people in the group', 'One car on the pad'],
      outLabel: 'Not included', outItems: ['A second car — extra charge', 'The 11th person onwards — extra charge', 'Photographer and equipment'],
      condLabel: 'Conditions', condItems: ['Duration 1–2 hours — one price', 'Weekdays, shoots end by 17:00', 'Weekends — 50% surcharge per aircraft'],
    },
    gift: {
      metaTitle: 'Gift certificate — HeliHop Travel', label: 'Gift', title: 'A gift they will remember', intro: 'When there is an occasion but the date is hard to guess. The recipient chooses the day.',
      howTitle: 'How to order', steps: ['Choose a route', 'Choose a seat', 'Send the passenger details'], note: 'The certificate must be activated within two months of purchase.', cta: 'Buy a certificate', all: 'All routes',
      cardTitle: 'Gift certificate', cardSub: 'A flight over the Tien Shan', cardFor: 'For', cardName: 'Recipient name', cardValid: 'Valid for 2 months', cardHint: 'Hover or tilt your phone',
    },
    guests: { metaTitle: 'They have flown with us — HeliHop Travel', label: 'Guests', title: 'They have flown with us', sub: 'Published only with personal consent.' },
    partners: {
      metaTitle: 'For partners — HeliHop Travel', label: 'For partners', title: 'Create more experiences for your guests',
      intro: 'HeliHop helps hotels, guides, tour operators and corporate clients add helicopter experiences to their offers.',
      withLabel: 'We work with', partners: [{ name: 'Remote Hotel', type: 'hotel' }, { name: 'Bakai Bank', type: 'bank' }, { name: 'Hyundai Center Kyrgyzstan', type: 'car centre' }, { name: 'Sofia Hotel', type: 'hotel' }], withNote: 'The list keeps growing.',
      whoLabel: 'Who it suits', who: [
        { title: 'Hotels and resorts', desc: 'helicopter experiences in the guest offer' },
        { title: 'Guides and tour operators', desc: 'exclusive flights inside client itineraries' },
        { title: 'DMCs and concierge', desc: 'an aviation partner for VIP guests' },
        { title: 'Corporate clients', desc: 'private events and incentive programmes' },
        { title: 'Event and wedding', desc: 'proposals, shoots and private experiences' },
      ],
      howLabel: 'How we start', how: ['A request on WhatsApp', 'We discuss the format', 'We agree terms and materials', 'First booking'], cta: 'Become a partner',
    },
    aviation: {
      metaTitle: 'Aviation services — HeliHop Travel', label: 'HeliHop for business', title: 'HeliHop for business and special tasks', intro: 'We carry out aviation work on request.',
      services: ['VIP flights', 'Private charters', 'Corporate events', 'Aerial photo and video', 'Geodetic and engineering work', 'Monitoring and inspection', 'Medical aviation', 'Search and rescue operations', 'Cargo transport', 'State and special missions'],
      cta: 'Discuss a task',
    },
    about: {
      metaTitle: 'About HeliHop — helicopters and safety', label: 'Helicopters', title: 'Helicopters and safety', intro: 'Three aircraft. We match the helicopter to the task, not the task to the helicopter.', ask: 'Ask about this aircraft',
      pilotsLabel: 'Who is at the controls', pilotsTitle: 'Safety',
      safety: ['More than 20 years in aviation, every pilot', '8,000+ flight hours', 'A medical check every 6 months — including psychological', 'Advanced training in Europe', 'Simulator training in the UAE', 'Full confidentiality'],
      flowLabel: 'How a flight goes', flowTitle: 'From request to landing',
      flow: [
        { title: 'Request and date', desc: 'We agree the route and choose a day by weather and aircraft availability.' },
        { title: 'Prepayment and booking', desc: 'After prepayment the slot is yours.' },
        { title: 'Briefing and instruction', desc: 'On the pad — a short briefing, safety rules, boarding.' },
        { title: 'Flight', desc: 'Panoramic windows, headsets with intercom, a mountain landing if the route has one.' },
        { title: 'Photographer', desc: 'After landing, 5–10 minutes of shooting and 10–20 keepsake photos.' },
      ],
    },
    credits: { metaTitle: 'Photo credits and licenses — HeliHop Travel', title: 'Photo credits and licenses', intro: 'Every photograph on this site is from HeliHop Travel flights and is published with the guests\' consent. © HeliHop Travel. Below are the fonts, libraries and data used on the site.' },
  },

  ky: {
    routes: {
      title: 'Кыргызстан боюнча вертолёт багыттары', metaTitle: 'Кыргызстан боюнча вертолёт багыттары — HeliHop Travel',
      sub: 'Биринчи кыска учуудан мөңгүлөргө жана көлдөргө бийик тоолуу багыттарга чейин.',
      compare: 'Багыттарды салыштыруу', compareCols: ['Багыт', 'Учуу', 'Жерде', 'Конуу', 'Терезе', 'Ортодогу', 'Бүт борт'],
      customTitle: 'Өз багытыңыз', customSub: 'Керектүү багыт табылган жокпу? Сизге ылайыктап түзөбүз — Кыргызстандын бардык жерине учабыз.',
    },
    route: {
      all: 'Бардык багыттар', price: 'Баасы', chooseSeat: 'Орун тандаңыз', seatNote: 'Терезенин жанындагы орундар кымбатыраак — көрүнүш жакшыраак. Бир орун алса да, бүт бортту алса да болот.', bookSeat: 'Орунга жазылуу', wantWhole: 'Бүт бортту каалайм', window: 'терезе', middle: 'ортодогу', pilot: 'пилот', selected: 'Тандалды', wholeNote: 'Бул багытты биз толугу менен гана беребиз — башка жүргүнчүлөрсүз. 4 адамга чейин.', bookWhole: 'Бортко жазылуу',
      expect: 'Сизди эмне күтөт', photos: 'Сүрөттөр', scheme: 'Багыттын схемасы', profile: 'Бийиктик профили', aircraft: 'Борт', ready: 'Учууга даярсызбы?', readySub: 'Жазыңыз — күндү тандап, суроолорго жооп беребиз.', other: 'Башка багыттар', highlights: 'Негизгиси', tapSeat: 'Тандоо үчүн орунду басыңыз', cabin: 'Airbus H125 салону · үстүнөн көрүнүш',
    },
    proposal: {
      metaTitle: 'Вертолётто сүйүү сунушу — HeliHop Travel', label: 'Биздин адистигибиз', title: 'Ал муну өмүр бою эстеп жүрөт',
      intro: 'Бардык убакытта биз жүздөн ашык сүйүү сунушун уюштурдук. Вертолёт кайда конорун, сүрөтчү кайда турарын жана ал ыйлап жиберсе эмне кыларын билебиз.', cta: 'Сценарийди талкуулоо',
      formatsLabel: 'Үч формат', formatsTitle: 'Сценарий тандаңыз', formatsSub: 'Баасы менен эмес, ким көрөрү менен айырмаланат: экөөңөр гана, силер жана тоолор же силер жана бардык коноктор.',
      scenarios: [
        { meta: '30 мүнөт учуу, 2 орун', title: 'Учуу учурунда', desc: 'Асманда сунуш, айнектин артында тоолордун панорамасы', price: '71 000 сомдон', image: 'mm-01' },
        { meta: '1 саат учуу + 30 мүнөткө чейин конуу', title: 'Тоого конуу менен', desc: 'Экөөңөр гана — ызы-чуусуз жана күбөлөрсүз', price: '131 000 сомдон', image: 'mm-02' },
        { meta: '30 мүнөт учуу, толук борт', title: 'Кооздоо менен', desc: 'Декор, муздак фонтандар, фотозона — жана аянтчадагы вертолёт', price: '135 000 сомдон', image: 'mm-03' },
      ],
      howLabel: 'Кандай болгон', howTitle: 'Чыныгы сунуштардын кадрлары', howSub: 'Жуптун макулдугу менен гана жарыялайбыз.',
      stepsLabel: 'Кантип уюштурулат', stepsTitle: 'Төрт кадам',
      steps: [
        { title: 'Форматты тандоо', desc: 'Ага кайсы сценарий туура келерин талкуулайбыз. Майда-чүйдөсү маанилүү: бийиктиктен коркобу, көңүл бурууну жактырабы.' },
        { title: 'Күндү жана жерди тандоо', desc: 'Аба ырайын жана жарык терезесин карайбыз. Күн батышы — эң күчтүү кадр, бирок эң капризи да.' },
        { title: 'Сценарийди макулдашуу', desc: 'Ким кайда турат, кайсы учурда шакекти чыгарасыз, камера кайда болот.' },
        { title: 'Даярдык жана учуу', desc: 'Инструктаж, жердеги декор, координатор күнү бою жаныңызда.' },
      ],
      trustLabel: 'Эмне үчүн бизге ишенишет', trustTitle: 'Уюштуруу', trust: ['Лицензиялуу пилоттор', 'Толук купуялуулук — ал гана билет', 'Учуу алдындагы инструктаж', 'Күнү бою жеке координатор'],
      finalTitle: 'Ал жөнүндө айтып бериңиз', finalSub: 'Биз сценарий сунуштайбыз. Милдеттенмесиз жана сүйлөшүү үчүн алдын ала төлөмсүз.',
    },
    experiences: {
      metaTitle: 'Таасирлер жана тартуу — HeliHop Travel', label: 'Тартуу', title: 'Таасир калат. Кадрлар да.',
      intro: 'Бул эки башка нерсе. Учуудан кийинки кадрлар баага кирет. Учуусуз тартуу — өз баасы бар өзүнчө кызмат.',
      afterLabel: 'Кошумча төлөмсүз', afterTitle: 'Учуудан кийинки кадрлар', afterDesc: 'Конгондон кийин сиз менен биздин сүрөтчү иштейт: 5–10 мүнөт, 10–20 даяр кадр. Бул эстелик кадрлар, алар учуунун баасына кирет.',
      shootLabel: 'Баасы', shootTitle: 'Учуусуз тартуу', shootDesc: 'Вертолёт аянтчада кыймылдаткычтары өчүк турат. Сыртынан жана салондун ичинде тартса болот — сценарийге канча керек болсо, ошончо.',
      prices: [{ name: 'Airbus H125', price: '30 000 сом' }, { name: 'Airbus H145', price: '35 000 сом' }], priceNote: 'Бир саатка да, эки саатка да баасы бирдей.', cta: 'Тартууга жазылуу',
      galleryLabel: 'Биздин кадрлар', galleryTitle: 'Бийиктиктен жана аянтчадан',
      forLabel: 'Кимге ылайык', forItems: ['Кийим бренддери жана жарнама тартуулары', 'Модель агенттиктери', 'Love Story', 'Үлпөт фотосессиялары'],
      inLabel: 'Кирет', inItems: ['Кыймылдаткычтары өчүк аянтчадагы вертолёт', 'Сыртынан жана салондун ичинде тартуу', 'Топто 10 адамга чейин', 'Аянтчада бир унаа'],
      outLabel: 'Кирбейт', outItems: ['Экинчи унаа — өзүнчө төлөм', '11-адам жана андан кийинкилер — өзүнчө төлөм', 'Сүрөтчүнүн иши жана жабдуулар'],
      condLabel: 'Шарттар', condItems: ['Узактыгы 1–2 саат — баасы бирдей', 'Жумуш күндөрү, тартууну 17:00гө чейин бүтүрөбүз', 'Дем алыш күндөрү — ар бир борттун баасына 50% кошумча төлөм'],
    },
    gift: {
      metaTitle: 'Белек сертификаты — HeliHop Travel', label: 'Белек', title: 'Эсте калчу белек', intro: 'Себеп бар, бирок күндү тандоо кыйын болгондо. Алуучу күндү өзү тандайт.',
      howTitle: 'Кантип алса болот', steps: ['Багыт тандоо', 'Орун тандоо', 'Жүргүнчүнүн маалыматын берүү'], note: 'Сертификатты сатып алган күндөн тартып эки айдын ичинде активдештирүү керек.', cta: 'Сертификат сатып алуу', all: 'Бардык багыттар',
      cardTitle: 'Белек сертификаты', cardSub: 'Тянь-Шандын үстүнөн учуу', cardFor: 'Кимге', cardName: 'Алуучунун аты', cardValid: '2 ай жарактуу', cardHint: 'Курсорду алып келиңиз же телефонду кыйшайтыңыз',
    },
    guests: { metaTitle: 'Биз менен учкандар — HeliHop Travel', label: 'Коноктор', title: 'Биз менен учкандар', sub: 'Жеке макулдук менен гана жарыялайбыз.' },
    partners: {
      metaTitle: 'Өнөктөштөргө — HeliHop Travel', label: 'Өнөктөштөргө', title: 'Конокторуңуз үчүн көбүрөөк таасир жаратыңыз',
      intro: 'HeliHop мейманканаларга, гиддерге, туроператорлорго жана корпоративдик кардарларга сунуштарына вертолёт таасирлерин кошууга жардам берет.',
      withLabel: 'Биз менен иштешет', partners: [{ name: 'Remote Hotel', type: 'мейманкана' }, { name: 'Bakai Bank', type: 'банк' }, { name: 'Hyundai Center Kyrgyzstan', type: 'автоборбор' }, { name: 'Sofia Hotel', type: 'мейманкана' }], withNote: 'Тизме толукталууда.',
      whoLabel: 'Кимге ылайык', who: [
        { title: 'Мейманканалар жана курорттор', desc: 'коноктор үчүн сунушта вертолёт таасирлери' },
        { title: 'Гиддер жана туроператорлор', desc: 'кардарлардын багыттарында эксклюзивдүү учуулар' },
        { title: 'DMC жана concierge', desc: 'VIP-коноктор үчүн авиациялык өнөктөш' },
        { title: 'Корпоративдик кардарлар', desc: 'private events жана incentive-программалар' },
        { title: 'Event жана wedding', desc: 'сунуштар, тартуулар жана private experiences' },
      ],
      howLabel: 'Кантип баштайбыз', how: ['WhatsApp аркылуу өтүнмө', 'Кызматташуу форматын талкуулайбыз', 'Шарттарды жана материалдарды макулдашабыз', 'Биринчи брондоо'], cta: 'Өнөктөш болуу',
    },
    aviation: {
      metaTitle: 'Авиациялык кызматтар — HeliHop Travel', label: 'Бизнес үчүн HeliHop', title: 'Бизнес жана атайын тапшырмалар үчүн HeliHop', intro: 'Суроо боюнча авиациялык иштерди аткарабыз.',
      services: ['VIP-учуулар', 'Жеке чартерлер', 'Корпоративдик иш-чаралар', 'Аэрофото- жана видеотартуу', 'Геодезиялык жана инженердик иштер', 'Объекттерди мониторингдөө жана текшерүү', 'Медициналык авиация', 'Издөө-куткаруу операциялары', 'Жүк ташуу', 'Мамлекеттик жана атайын тапшырмалар'],
      cta: 'Тапшырманы талкуулоо',
    },
    about: {
      metaTitle: 'HeliHop жөнүндө — вертолёттор жана коопсуздук', label: 'Вертолёттор', title: 'Вертолёттор жана коопсуздук', intro: 'Үч борт. Тапшырмага ылайык бортту тандайбыз, бортко ылайык тапшырманы эмес.', ask: 'Борт жөнүндө суроо',
      pilotsLabel: 'Ким башкарат', pilotsTitle: 'Коопсуздук',
      safety: ['Ар бир пилоттун авиацияда 20 жылдан ашык тажрыйбасы', '8 000 сааттан ашык учуу', 'Ар 6 айда медициналык текшерүү — психологиялык текшерүүнү кошо', 'Европада квалификацияны жогорулатуу', 'БАЭде симуляторлордо машыгуу', 'Толук купуялуулук'],
      flowLabel: 'Учуу кантип өтөт', flowTitle: 'Өтүнмөдөн конууга чейин',
      flow: [
        { title: 'Өтүнмө жана күн', desc: 'Багытты макулдашып, аба ырайына жана борттун бош убактысына жараша күндү тандайбыз.' },
        { title: 'Алдын ала төлөм жана бронь', desc: 'Алдын ала төлөмдөн кийин убакыт сизге бекитилет.' },
        { title: 'Брифинг жана инструктаж', desc: 'Аянтчада — кыска брифинг, коопсуздук эрежелери, вертолётко отуруу.' },
        { title: 'Учуу', desc: 'Панорамалык терезелер, пилот менен байланышы бар кулакчындар, багытта болсо — тоого конуу.' },
        { title: 'Сүрөтчү', desc: 'Конгондон кийин 5–10 мүнөт тартуу жана 10–20 эстелик кадр.' },
      ],
    },
    credits: { metaTitle: 'Сүрөттөр жана лицензиялар — HeliHop Travel', title: 'Сүрөттөр жана лицензиялар', intro: 'Сайттагы бардык сүрөттөр — HeliHop Travel учууларынан, коноктордун макулдугу менен жарыяланат. © HeliHop Travel. Төмөндө — сайтта колдонулган шрифттер, китепканалар жана маалыматтар.' },
  },
};

module.exports = { pages, faq, fleet, guests };
