
import React from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { Languages, Home, Settings } from 'lucide-react';

type MainLayoutProps = {
    left: React.ReactNode;
    middle: React.ReactNode;
    right?: React.ReactNode;
    onHome: () => void;
    onSettings?: () => void;
    settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
    variant?: 'default' | 'add_agent';
    layout?: 'standard' | 'compare';
};

const MainLayout: React.FC<MainLayoutProps> = ({
    left,
    middle,
    right,
    onHome,
    onSettings,
    settingsButtonRef,
    variant = 'default',
    layout = 'standard'
}) => {
    const { locale, setLocale, t } = useI18n();
    const isAddAgent = variant === 'add_agent';
    const isCompareLayout = layout === 'compare';
    const rootClass = isAddAgent
        ? 'relative h-screen bg-transparent flex flex-col font-sans overflow-hidden'
        : 'h-screen bg-slate-50 flex flex-col font-sans overflow-hidden';
    const headerClass = isAddAgent
        ? 'flex-none px-6 py-4 bg-white/80 backdrop-blur border-b border-indigo-100 flex justify-between items-center z-10'
        : 'flex-none px-6 py-4 bg-white/80 backdrop-blur border-b border-indigo-100 flex justify-between items-center z-10';
    const titleClass = isAddAgent
        ? 'text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600'
        : 'text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600';
    const buttonClass = isAddAgent
        ? 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors text-sm font-medium text-slate-600'
        : 'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors text-sm font-medium text-slate-600';

    return (
        <div className={rootClass}>
            {/* Header - Fixed Height */}
            <header className={headerClass}>
                <div>
                    <h1 className={titleClass}>
                        {t('title')}
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">{t('subtitle')}</p>
                </div>

                <div className="flex items-center gap-3">
                    {onSettings && (
                        <button
                            ref={settingsButtonRef}
                            onClick={onSettings}
                            className={buttonClass}
                            title={locale === 'en' ? 'Settings' : '设置'}
                        >
                            <Settings size={14} />
                            {locale === 'en' ? 'Settings' : '设置'}
                        </button>
                    )}
                    
                    <button
                        onClick={onHome}
                        className={buttonClass}
                        title={locale === 'en' ? 'Back to Home' : '返回首页'}
                    >
                        <Home size={14} />
                        {locale === 'en' ? 'Home' : '首页'}
                    </button>

                    <button
                        onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
                        className={buttonClass}
                    >
                        <Languages size={14} />
                        {locale === 'en' ? 'English' : '中文'}
                    </button>
                </div>
            </header>

            {/* Main Content - Flex-1 (Takes remaining height) */}
            <main
                className={
                    isCompareLayout
                        ? 'relative z-10 flex-1 min-h-0 w-full max-w-[1800px] mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6'
                        : 'relative z-10 flex-1 min-h-0 w-full max-w-[1800px] mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_380px] gap-6'
                }
            >

                {/* Left: Control Panel (Independent Scroll) */}
                <div className="h-full overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                    {left}
                </div>

                {/* Center: Execution Feed (Independent Scroll) */}
                <div className="h-full overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent relative">
                    {middle}
                </div>

                {!isCompareLayout && (
                    <div className="h-full overflow-y-auto pl-2 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                        {right}
                    </div>
                )}

            </main>
        </div>
    );
};

export default MainLayout;
