import React, { createContext, useContext, useState, type ReactNode } from 'react';
import { translations, type Locale } from './translations';

type I18nContextType = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: keyof typeof translations['en']) => string;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [locale, setLocale] = useState<Locale>('zh');

    const t = (key: keyof typeof translations['en']): string => {
        return translations[locale][key] || key;
    };

    return (
        <I18nContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </I18nContext.Provider>
    );
};

export const useI18n = () => {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n must be used within an I18nProvider');
    }
    return context;
};
