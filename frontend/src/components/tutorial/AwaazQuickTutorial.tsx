'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { LanguageCode } from '@awaaz/shared';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  Hand,
  Lock,
  Mic,
  Phone,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { AwaazLogo } from '@/components/shared/AwaazLogo';
import { useI18n } from '@/lib/i18n/context';

export const AWAAZ_TUTORIAL_STORAGE_KEY = 'awaaz_tutorial_seen_v1';

interface TutorialStepCopy {
  title: string;
  body: string;
  badge: string;
  actionHint: string;
}

interface TutorialLocaleBundle {
  headerTitle: string;
  headerSubtitle: string;
  skipBtn: string;
  prevBtn: string;
  nextBtn: string;
  finishBtn: string;
  listenBtn: string;
  stopListenBtn: string;
  stepOf: string;
  steps: [TutorialStepCopy, TutorialStepCopy, TutorialStepCopy, TutorialStepCopy, TutorialStepCopy];
}

const TUTORIAL_COPY: Record<LanguageCode, TutorialLocaleBundle> = {
  en: {
    headerTitle: 'Quick Button Guide',
    headerSubtitle: '5 simple buttons to use Awaaz effortlessly',
    skipBtn: 'Skip & Start',
    prevBtn: 'Previous',
    nextBtn: 'Next',
    finishBtn: 'Start Using Awaaz',
    listenBtn: 'Listen',
    stopListenBtn: 'Stop Audio',
    stepOf: 'Step {current} of {total}',
    steps: [
      {
        badge: 'Speak • Interrupt • Stop',
        title: 'Voice Orb, Interrupt & Hard Stop',
        body: 'Tap the big Mic Orb to speak naturally in your language. Tap while AI speaks to interrupt immediately, or press Stop for complete silence.',
        actionHint: 'Mic Orb • Interrupt & Answer • Stop',
      },
      {
        badge: '6 Pakistani Languages',
        title: 'Instant 6-Language Switcher',
        body: 'Switch anytime between English, Urdu, Sindhi, Punjabi, Pashto, and Balochi — screen text and AI voice switch instantly without losing your form.',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'Vision + Anti-Scam Shield',
        title: 'Scan CNIC / Document & Scam SMS Check',
        body: 'Upload or scan a CNIC, income bill, or suspicious 8171 SMS to auto-fill details, expose scams, and flag tampered docs without punishing blurry photos.',
        actionHint: 'Scan CNIC / Doc • Scam SMS Check',
      },
      {
        badge: 'Zero-Internet Friendly',
        title: 'Keypad Phone Demo & Offline Queue',
        body: 'No smartphone or weak signal? Use Keypad Phone Demo to file by voice call, or switch Offline Mode to save claims and auto-sync when internet returns.',
        actionHint: 'Keypad Phone Demo • Online / Offline Toggle',
      },
      {
        badge: 'Full Citizen Control',
        title: 'My Data, Consent & Live Status',
        body: 'Check who currently has your data, withdraw consent in 1 tap to block access immediately, track claim status, or ask a Department Officer directly.',
        actionHint: 'My Data & Consent • Track Status • Ask Officer',
      },
    ],
  },
  ur: {
    headerTitle: 'بٹنوں کی مختصر رہنمائی',
    headerSubtitle: 'آواز کو آسانی سے استعمال کرنے کے 5 اہم بٹن',
    skipBtn: 'چھوڑیں / شروع کریں',
    prevBtn: 'پیچھے',
    nextBtn: 'اگلا',
    finishBtn: 'آواز شروع کریں',
    listenBtn: 'سنیں',
    stopListenBtn: 'آواز روکیں',
    stepOf: 'مرحلہ {current} از {total}',
    steps: [
      {
        badge: 'بولیں • روکیں • خاموشی',
        title: 'مائیک بٹن، مداخلت اور فوری خاموشی',
        body: 'اپنی زبان میں بولنے کے لیے بڑے مائیک بٹن کو دبائیں۔ AI بولتے وقت فوری بات کاٹنے کے لیے مائیک یا "روک کر جواب دیں" دبائیں، اور مکمل خاموشی کے لیے "روکیں" دبائیں۔',
        actionHint: 'مائیک بٹن • روک کر جواب دیں • روکیں',
      },
      {
        badge: '6 پاکستانی زبانیں',
        title: '6 زبانوں کی فوری تبدیلی',
        body: 'کسی بھی وقت انگریزی، اردو، سندھی، پنجابی، پشتو یا بلوچی منتخب کریں — اسکرین کا متن اور AI کی آواز فارم ضائع کیے بغیر فوراً بدل جائیں گے۔',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'اسکین + دھوکہ دہی سے تحفظ',
        title: 'شناختی کارڈ اسکین اور جعلی SMS جانچ',
        body: 'شناختی کارڈ، بل یا مشکوک 8171 پیغام اپلوڈ کریں تاکہ فارم خودکار بھرا جائے، فراڈ پکڑا جائے اور جعلی دستاویز کی نشاندہی ہو — دھندلی تصویر پر پابندی نہیں لگتی۔',
        actionHint: 'شناختی کارڈ اسکین • اسکیم جانچ',
      },
      {
        badge: 'کمزور انٹرنیٹ کے لیے تیار',
        title: 'کی پیڈ فون ڈیمو اور آف لائن قطار',
        body: 'اسمارٹ فون یا انٹرنیٹ نہیں؟ کی پیڈ فون ڈیمو سے کال کے ذریعے درخواست دیں، یا آف لائن موڈ میں درخواست محفوظ کریں جو نیٹ آتے ہی خود جمع ہو جائے گی۔',
        actionHint: 'کی پیڈ فون ڈیمو • آن لائن / آف لائن بٹن',
      },
      {
        badge: 'مکمل شہری اختیار',
        title: 'میرا ڈیٹا، رضامندی اور درخواست اسٹیٹس',
        body: 'دیکھیں آپ کا ڈیٹا کس کے پاس ہے، ایک کلک سے رضامندی واپس لے کر رسائی فوراً بند کریں، درخواست کا اسٹیٹس جانیں یا محکمہ افسر سے براہِ راست سوال پوچھیں۔',
        actionHint: 'میرا ڈیٹا اور اجازت • اسٹیٹس • افسر سے سوال',
      },
    ],
  },
  sd: {
    headerTitle: 'بٽڻن جي مختصر رهنمائي',
    headerSubtitle: 'آواز آساني سان هلائڻ جا 5 اهم بٽڻ',
    skipBtn: 'ڇڏيو / شروع ڪريو',
    prevBtn: 'پويون',
    nextBtn: 'اڳيون',
    finishBtn: 'آواز شروع ڪريو',
    listenBtn: 'ٻڌو',
    stopListenBtn: 'آواز بند ڪريو',
    stepOf: 'مرحلو {current} مان {total}',
    steps: [
      {
        badge: 'ڳالهايو • روڪيو • خاموشي',
        title: 'مائيڪ بٽڻ، مداخلت ۽ مڪمل خاموشي',
        body: 'پنهنجي ٻولي ۾ ڳالهائڻ لاءِ وڏو مائيڪ بٽڻ دٻايو. AI ڳالهائيندي وقت فوري روڪڻ لاءِ مائيڪ دٻايو يا مڪمل خاموشي لاءِ اسٽاپ دٻايو.',
        actionHint: 'مائيڪ بٽڻ • روڪي جواب ڏيو • بند ڪريو',
      },
      {
        badge: '6 پاڪستاني ٻوليون',
        title: '6 ٻولين جي فوري تبديلي',
        body: 'ڪنهن به وقت انگريزي، اردو، سنڌي، پنجابي، پشتو يا بلوچي چونڊيو — اسڪرين ۽ AI آواز فارم وڃائڻ کانسواءِ فوري تبديل ٿيندا.',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'اسڪين + فراڊ کان بچاءُ',
        title: 'شناختي ڪارڊ اسڪين ۽ جعلي SMS جاچ',
        body: 'شناختي ڪارڊ، بل يا مشڪوڪ 8171 ميسيج اپلوڊ ڪريو ته جيئن تفصيل پاڻمرادو ڀرجن، فراڊ پڪڙجي ۽ ڌنڌلي فوٽو تي بلاڪ نه ٿئي.',
        actionHint: 'شناختي ڪارڊ اسڪين • اسڪيم جاچ',
      },
      {
        badge: 'آف لائن مدد',
        title: 'ڪي پيڊ فون ڊيمو ۽ آف لائن موڊ',
        body: 'انٽرنيٽ يا اسمارٽ فون ناهي؟ ڪي پيڊ فون ڊيمو ذريعي ڪال تي درخواست ڏيو، يا آف لائن محفوظ ڪريو جيڪا نيٽ ايندي ئي خود جمع ٿي ويندي.',
        actionHint: 'ڪي پيڊ فون ڊيمو • آن لائن / آف لائن',
      },
      {
        badge: 'مڪمل شهري اختيار',
        title: 'منهنجو ڊيٽا، اجازت ۽ اسٽيٽس',
        body: 'ڏسو اوهان جو ڊيٽا ڪنهن وٽ آهي، هڪ ڪلڪ سان اجازت واپس وٺي رسائي بند ڪريو، درخواست جو اسٽيٽس ڏسو يا آفيسر کان سوال پڇو.',
        actionHint: 'منهنجو ڊيٽا • اسٽيٽس • آفيسر کان سوال',
      },
    ],
  },
  pa: {
    headerTitle: 'بٹناں دی مختصر رہنمائی',
    headerSubtitle: 'آواز سوکھے طریقے نال ورتن لئی 5 اہم بٹن',
    skipBtn: 'چھڈو / شروع کرو',
    prevBtn: 'پچھے',
    nextBtn: 'اگلا',
    finishBtn: 'آواز شروع کرو',
    listenBtn: 'سنو',
    stopListenBtn: 'آواز روکو',
    stepOf: 'مرحلہ {current} وچوں {total}',
    steps: [
      {
        badge: 'بولو • روکو • خاموشی',
        title: 'مائیک بٹن، مداخلت تے فوری خاموشی',
        body: 'اپنی زبان وچ بولن لئی وڈا مائیک بٹن دباؤ۔ AI بولدیاں ہویاں گل کٹن لئی مائیک دباؤ یا پوری خاموشی لئی روکن دا بٹن دباؤ۔',
        actionHint: 'مائیک بٹن • روک کے جواب دیو • روکو',
      },
      {
        badge: '6 پاکستانی زباناں',
        title: '6 زباناں دی فوری تبدیلی',
        body: 'کسے وی ویلے انگریزی، اردو، سندھی، پنجابی، پشتو یا بلوچی چنو — سکرین تے آواز فارم گوائے بغیر فوراً بدل جان گے۔',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'اسکین + دھوکے توں بچاؤ',
        title: 'شناختی کارڈ اسکین تے جعلی SMS جانچ',
        body: 'شناختی کارڈ، بل یا مشکوک 8171 پیغام اپلوڈ کرو تاں جے فارم آپے بھرے، فراڈ پکڑیا جاوے تے دھندلی فوٹو تے پابندی نہ لگے۔',
        actionHint: 'شناختی کارڈ اسکین • اسکیم جانچ',
      },
      {
        badge: 'بغیر نیٹ سہولت',
        title: 'کی پیڈ فون ڈیمو تے آف لائن قطار',
        body: 'سمارٹ فون یا نیٹ نہیں؟ کی پیڈ فون ڈیمو نال کال تے درخواست دیو یا آف لائن محفوظ کرو، نیٹ آؤندیاں ای آپے جمع ہو جاوے گی۔',
        actionHint: 'کی پیڈ فون ڈیمو • آن لائن / آف لائن',
      },
      {
        badge: 'پورا شہری اختیار',
        title: 'میرا ڈیٹا، اجازت تے اسٹیٹس',
        body: 'ویکھو تہاڈا ڈیٹا کس کول اے، اک کلک نال اجازت واپس لے کے رسائی روکو، درخواست دا حال جانو یا افسر کولوں سدھا سوال پچھو۔',
        actionHint: 'میرا ڈیٹا • اسٹیٹس • افسر نال رابطہ',
      },
    ],
  },
  ps: {
    headerTitle: 'د تڼیو لنډ لارښود',
    headerSubtitle: 'د آواز اسانه کارونې لپاره ۵ مهمې تڼۍ',
    skipBtn: 'پرېږدئ / پیل کړئ',
    prevBtn: 'شاته',
    nextBtn: 'بل',
    finishBtn: 'آواز پیل کړئ',
    listenBtn: 'واورئ',
    stopListenBtn: 'غږ ودروئ',
    stepOf: 'پړاو {current} له {total}',
    steps: [
      {
        badge: 'خبرې • مداخله • چوپتیا',
        title: 'د مایک تڼۍ، مداخله او بشپړه چوپتیا',
        body: 'په خپله ژبه د خبرو لپاره لوی مایک تڼۍ کیکاږئ. د AI د خبرو پر مهال د سمدستي مداخلې لپاره مایک یا د بشپړې چوپتیا لپاره سټاپ کیکاږئ.',
        actionHint: 'مایک تڼۍ • سمدستي ځواب • بندول',
      },
      {
        badge: '۶ پاکستانۍ ژبې',
        title: 'د ۶ ژبو سمدستي بدلون',
        body: 'هر وخت انګلیسي، اردو، سندهي، پنجابي، پښتو یا بلوڅي وټاکئ — د سکرین متن او د AI غږ بې له دې چې فارم ضایع شي سمدستي بدلېږي.',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'سکن + د درغلۍ مخنیوی',
        title: 'د تذکرې/CNIC سکن او جعلي SMS کتل',
        body: 'CNIC، بل یا شکمن 8171 پیغام پورته کړئ چې معلومات په خپله ډک شي، درغلي وپېژندل شي او تت انځورونه بند نه شي.',
        actionHint: 'CNIC سکن • د درغلۍ کتل',
      },
      {
        badge: 'آفلاین ملاتړ',
        title: 'کیپیډ فون ډیمو او آفلاین کتار',
        body: 'سمارټ فون یا انټرنیټ نلرئ؟ د کیپیډ فون ډیمو له لارې غوښتنه وکړئ، یا یې آفلاین خوندي کړئ چې د انټرنیټ راتلو سره په خپله ولېږل شي.',
        actionHint: 'کیپیډ فون ډیمو • آنلاین / آفلاین',
      },
      {
        badge: 'بشپړ ولسي واک',
        title: 'زما معلومات، اجازه او حالت',
        body: 'وګورئ ستاسو معلومات له چا سره دي، په یو کلک اجازه بېرته واخلئ، د غوښتنلیک حالت وګورئ یا له افسر څخه مستقیمه پوښتنه وکړئ.',
        actionHint: 'زما معلومات او اجازه • حالت • له افسر پوښتنه',
      },
    ],
  },
  bal: {
    headerTitle: 'بٹنانی گونڈیں رہشونی',
    headerSubtitle: 'آواز ءِ آسانی کارمرز کنگ ءِ ۵ بُنیادی بٹن',
    skipBtn: 'بلّ / بندات کن',
    prevBtn: 'پشت ءَ',
    nextBtn: 'دیمتر',
    finishBtn: 'آواز بندات کن',
    listenBtn: 'گوش دار',
    stopListenBtn: 'توار بند کن',
    stepOf: 'تک {current} چہ {total}',
    steps: [
      {
        badge: 'گپ • دارگ • بے تواری',
        title: 'مائیک بٹن، مداخلت ءُ سرجمیں بے تواری',
        body: 'وتی زبان ءَ گپ جنگ ءِ واستا مزنیں مائیک بٹن ءَ بہ جن۔ AI گپ ءِ وھد ءَ زوت دارگ ءِ واستا مائیک یا سرجمیں بے تواری ءِ واستا اسٹاپ بہ جن۔',
        actionHint: 'مائیک بٹن • زوت پسّو • بند کن',
      },
      {
        badge: '۶ پاکستانی زبان',
        title: '۶ زبانانی زوت بدلی',
        body: 'ہر وھد انگریزی، اردو، سندھی، پنجابی، پشتو یا بلوچی گچین کن — اسکرین ءِ نبشتہ ءُ AI توار فارم ءِ زیاں بُوہگ ءَ ابید زوت بدل بنت۔',
        actionHint: 'English • اردو • سنڌي • پنجابی • پشتو • بلوچی',
      },
      {
        badge: 'اسکین + دوکہ بازی ءَ چہ رکّگ',
        title: 'شناختی کارڈ اسکین ءُ دروگیں SMS چارگ',
        body: 'شناختی کارڈ، بل یا مشکوک 8171 پیگام اپلوڈ کن کہ فارم وتی سرا پر ببیت، فراڈ گرگ ببیت ءُ دُندلیں عکسانی سرا بندش مہ بیت۔',
        actionHint: 'کارڈ اسکین • اسکیم چارگ',
      },
      {
        badge: 'آف لائن کمک',
        title: 'کی پیڈ فون ڈیمو ءُ آف لائن کتار',
        body: 'انٹرنیٹ یا اسمارٹ فون نیست؟ کی پیڈ فون ڈیمو ءَ چہ کال ءِ سر ءَ عرضی بدے یا آف لائن محفوظ کن کہ نیٹ آیگ ءَ گوں وت جمع ببیت۔',
        actionHint: 'کی پیڈ فون ڈیمو • آن لائن / آف لائن',
      },
      {
        badge: 'سرجمیں شہری واک',
        title: 'منی ڈیٹا، اجازت ءُ عرضی ءِ حال',
        body: 'بچار تئی ڈیٹا کئے ءِ کرا انت، یک کلک ءَ اجازت واپس بگر ءُ رسائی بند کن، عرضی ءِ حال ءَ بچار یا افسر ءَ چہ جُست کن۔',
        actionHint: 'منی ڈیٹا ءُ اجازت • حال • افسر ءَ چہ جُست',
      },
    ],
  },
};

const SPEECH_LANG_MAP: Record<LanguageCode, string> = {
  en: 'en-US',
  ur: 'ur-PK',
  sd: 'sd-PK',
  pa: 'pa-PK',
  ps: 'ps-AF',
  bal: 'ur-PK',
};

const STEP_VISUALS = [
  {
    icon: Mic,
    secondaryIcon: Hand,
    gradient: 'from-[#0F2D5C] via-[#1D4ED8] to-[#2563EB]',
    accentBg: 'bg-blue-50 border-blue-200 text-blue-950',
    pillBg: 'bg-blue-100 text-blue-950 border-blue-300',
  },
  {
    icon: Globe,
    secondaryIcon: Sparkles,
    gradient: 'from-blue-700 via-sky-600 to-indigo-800',
    accentBg: 'bg-sky-50 border-sky-200 text-sky-950',
    pillBg: 'bg-sky-100 text-sky-950 border-sky-300',
  },
  {
    icon: Camera,
    secondaryIcon: ShieldCheck,
    gradient: 'from-amber-500 via-amber-600 to-orange-700',
    accentBg: 'bg-amber-50 border-amber-200 text-amber-950',
    pillBg: 'bg-amber-100 text-amber-950 border-amber-300',
  },
  {
    icon: Phone,
    secondaryIcon: WifiOff,
    gradient: 'from-slate-800 via-[#0F2D5C] to-slate-950',
    accentBg: 'bg-slate-100 border-slate-300 text-slate-900',
    pillBg: 'bg-amber-100 text-amber-950 border-amber-300',
  },
  {
    icon: Lock,
    secondaryIcon: CheckCircle2,
    gradient: 'from-indigo-700 via-blue-800 to-slate-900',
    accentBg: 'bg-indigo-50 border-indigo-200 text-indigo-950',
    pillBg: 'bg-indigo-100 text-indigo-950 border-indigo-300',
  },
] as const;

export function AwaazQuickTutorial({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { language, direction } = useI18n();
  const [stepIdx, setStepIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const bundle = TUTORIAL_COPY[language] ?? TUTORIAL_COPY.en;
  const totalSteps = bundle.steps.length;
  const activeStep = bundle.steps[stepIdx] ?? bundle.steps[0];
  const visual = STEP_VISUALS[stepIdx] ?? STEP_VISUALS[0];
  const MainIcon = visual.icon;
  const SecondaryIcon = visual.secondaryIcon;

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore speech cancellation issues in headless environments
      }
    }
    setSpeaking(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopSpeech();
    } else {
      setStepIdx(0);
    }
    return () => {
      stopSpeech();
    };
  }, [open, stopSpeech]);

  const handleDismiss = useCallback(() => {
    stopSpeech();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AWAAZ_TUTORIAL_STORAGE_KEY, '1');
    }
    onClose();
  }, [onClose, stopSpeech]);

  const handleStepChange = useCallback(
    (nextIdx: number) => {
      stopSpeech();
      setStepIdx(Math.max(0, Math.min(totalSteps - 1, nextIdx)));
    },
    [stopSpeech, totalSteps],
  );

  const handleListen = useCallback(() => {
    if (speaking) {
      stopSpeech();
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(`${activeStep.title}. ${activeStep.body}`);
      utt.lang = SPEECH_LANG_MAP[language] ?? 'en-US';
      utt.rate = 0.96;
      utt.onend = () => setSpeaking(false);
      utt.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utt);
    } catch {
      setSpeaking(false);
    }
  }, [activeStep.body, activeStep.title, language, speaking, stopSpeech]);

  if (!open) return null;

  const isLastStep = stepIdx === totalSteps - 1;
  const stepCounterLabel = bundle.stepOf
    .replace('{current}', String(stepIdx + 1))
    .replace('{total}', String(totalSteps));

  return (
    <div
      data-testid="awaaz-quick-tutorial"
      role="dialog"
      aria-modal="true"
      aria-label={bundle.headerTitle}
      dir={direction}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white border-2 border-blue-700/30 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Branded Header */}
        <div className="bg-gradient-to-r from-[#0F2D5C] via-[#1D4ED8] to-[#2563EB] px-5 py-4 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AwaazLogo size="sm" inverted />
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white truncate">
                {bundle.headerTitle}
              </h2>
              <p className="text-xs sm:text-sm font-semibold text-sky-100 truncate">
                {bundle.headerSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="tutorial-skip-btn"
              onClick={handleDismiss}
              className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-extrabold shadow-xs transition cursor-pointer"
            >
              {bundle.skipBtn}
            </button>
            <button
              type="button"
              aria-label={bundle.skipBtn}
              onClick={handleDismiss}
              className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Slide Body */}
        <div className="p-5 sm:p-7 space-y-5 bg-gradient-to-b from-white to-slate-50">
          {/* Progress Bar & Step Counter */}
          <div className="flex items-center justify-between gap-3">
            <span
              data-testid="tutorial-step-counter"
              className="px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-extrabold tracking-wide"
            >
              {stepCounterLabel}
            </span>
            <span className={`px-3 py-1 rounded-full border text-xs font-extrabold ${visual.pillBg}`}>
              {activeStep.badge}
            </span>
          </div>

          {/* Visual Highlight Card */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              {/* Large Bold Icon Emblem */}
              <div
                className={`relative h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-gradient-to-br ${visual.gradient} text-white flex items-center justify-center shadow-lg shrink-0`}
              >
                <MainIcon className="h-10 w-10 sm:h-11 sm:w-11" />
                <span className="absolute -bottom-2 -end-2 h-8 w-8 rounded-xl bg-amber-400 text-slate-950 border-2 border-white flex items-center justify-center shadow-md">
                  <SecondaryIcon className="h-4 w-4" />
                </span>
              </div>

              <div className="flex-1 text-center sm:text-start space-y-2.5 min-w-0">
                <h3
                  data-testid="tutorial-step-title"
                  className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-snug"
                >
                  {activeStep.title}
                </h3>
                <p className="text-base font-bold text-slate-800 leading-relaxed">
                  {activeStep.body}
                </p>
              </div>
            </div>

            {/* Button Preview Pill + Listen Button */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/80">
              <div
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs sm:text-sm font-extrabold ${visual.accentBg}`}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>{activeStep.actionHint}</span>
              </div>

              <button
                type="button"
                data-testid="tutorial-listen-btn"
                onClick={handleListen}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold border-2 transition cursor-pointer ${
                  speaking
                    ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700'
                    : 'bg-blue-50 hover:bg-blue-100 text-blue-950 border-blue-400'
                }`}
              >
                {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                <span>{speaking ? bundle.stopListenBtn : bundle.listenBtn}</span>
              </button>
            </div>
          </div>

          {/* Clickable Step Dots */}
          <div className="flex items-center justify-center gap-2">
            {bundle.steps.map((s, idx) => (
              <button
                key={s.title}
                type="button"
                data-testid={`tutorial-step-dot-${idx}`}
                aria-label={`${idx + 1} / ${totalSteps}`}
                onClick={() => handleStepChange(idx)}
                className={`h-3 rounded-full transition-all cursor-pointer ${
                  idx === stepIdx ? 'w-10 bg-blue-700' : 'w-3 bg-slate-300 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>

          {/* Footer Navigation */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              data-testid="tutorial-prev-btn"
              disabled={stepIdx === 0}
              onClick={() => handleStepChange(stepIdx - 1)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-slate-300 bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>{bundle.prevBtn}</span>
            </button>

            {isLastStep ? (
              <button
                type="button"
                data-testid="tutorial-finish-btn"
                onClick={handleDismiss}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold text-sm sm:text-base shadow-md transition cursor-pointer"
              >
                <CheckCircle2 className="h-5 w-5" />
                <span>{bundle.finishBtn}</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="tutorial-next-btn"
                onClick={() => handleStepChange(stepIdx + 1)}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold text-sm sm:text-base shadow-md transition cursor-pointer"
              >
                <span>{bundle.nextBtn}</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
