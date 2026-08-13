import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const messages = {
  'zh-CN': {
    language: '语言', login: '统一登录', register: '注册账号', logout: '退出',
    dashboard: '工作台', documents: '资料中心', tasks: '共享询价任务', templates: '我的账号模板',
    excel: 'Excel工具', accounts: '账号管理', database: '数据库', external: '外部接收箱',
    manager: '主管/经理', purchaser: '采购专员', overseas: '海外业务员', admin: '总经理',
    approval: '注册申请已提交，请等待负责人审核后登录。', pending: '待审核'
  },
  'en-US': {
    language: 'Language', login: 'Sign in', register: 'Create account', logout: 'Sign out',
    dashboard: 'Workspace', documents: 'Documents', tasks: 'Shared RFQ tasks', templates: 'My templates',
    excel: 'Excel tools', accounts: 'Accounts', database: 'Database', external: 'External inbox',
    manager: 'Supervisor / Manager', purchaser: 'Purchasing specialist', overseas: 'Overseas sales', admin: 'General manager',
    approval: 'Registration submitted. Please wait for approval.', pending: 'Pending approval'
  },
  'es-ES': {
    language: 'Idioma', login: 'Iniciar sesión', register: 'Crear cuenta', logout: 'Salir',
    dashboard: 'Espacio de trabajo', documents: 'Documentos', tasks: 'Tareas RFQ compartidas', templates: 'Mis plantillas',
    excel: 'Herramientas Excel', accounts: 'Cuentas', database: 'Base de datos', external: 'Bandeja externa',
    manager: 'Supervisor / Gerente', purchaser: 'Especialista de compras', overseas: 'Ventas internacionales', admin: 'Director general',
    approval: 'Registro enviado. Espere la aprobación.', pending: 'Pendiente de aprobación'
  }
};

const LanguageContext = createContext(null);
export const languageOptions = [
  ['zh-CN', '中文'],
  ['en-US', 'English'],
  ['es-ES', 'Español']
];

export function I18nProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('latic-language') || 'zh-CN');
  useEffect(() => {
    localStorage.setItem('latic-language', language);
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: key => messages[language]?.[key] || messages['zh-CN'][key] || key
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  return useContext(LanguageContext) || { language: 'zh-CN', setLanguage: () => {}, t: key => key };
}
