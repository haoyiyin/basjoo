'use client';

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 静态导入语言文件
import zhCNCommon from '../locales/zh-CN/common.json';
import zhCNAuth from '../locales/zh-CN/auth.json';
import enUSCommon from '../locales/en-US/common.json';
import enUSAuth from '../locales/en-US/auth.json';

// 强制保留翻译资源，防止被tree-shaking
const zhCNCommonData = JSON.parse(JSON.stringify(zhCNCommon));
const zhCNAuthData = JSON.parse(JSON.stringify(zhCNAuth));
const enUSCommonData = JSON.parse(JSON.stringify(enUSCommon));
const enUSAuthData = JSON.parse(JSON.stringify(enUSAuth));

// Get initial language from localStorage or default to zh-CN
const getInitialLanguage = (): string => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('basjoo_locale');
    if (stored && (stored === 'zh-CN' || stored === 'en-US')) {
      return stored;
    }
  }
  return 'zh-CN';
};

const resources = {
  'zh-CN': {
    common: zhCNCommonData,
    auth: zhCNAuthData,
  },
  'en-US': {
    common: enUSCommonData,
    auth: enUSAuthData,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    ns: ['common', 'auth'],
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'basjoo_locale',
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
    interpolation: {
      escapeValue: false,
    },
    saveMissing: false,
  });

export default i18n;
