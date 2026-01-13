import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18n } from '../../i18n/I18nContext';

interface TutorialTooltipProps {
    isOpen: boolean;
    step: number;
    totalSteps: number;
    onNext: () => void;
    onSkip: () => void;
    targetRef?: React.RefObject<HTMLElement | null> | null;
}

const TutorialTooltip: React.FC<TutorialTooltipProps> = ({
    isOpen,
    step,
    totalSteps,
    onNext,
    onSkip,
    targetRef
}) => {
    const [position, setPosition] = React.useState({ top: 0, left: 0 });
    const [arrowPosition, setArrowPosition] = React.useState<'top' | 'bottom' | 'left' | 'right'>('top');
    const { locale } = useI18n();

    React.useEffect(() => {
        if (targetRef?.current && isOpen) {
            const rect = targetRef.current.getBoundingClientRect();
            
            // 根据步骤决定提示框位置
            let tooltipTop = 0;
            let tooltipLeft = 0;
            let arrow: 'top' | 'bottom' | 'left' | 'right' = 'top';

            switch (step) {
                case 1: // 设置按钮 - 下方
                    tooltipTop = rect.bottom + 15;
                    tooltipLeft = rect.left - 80;
                    arrow = 'top';
                    break;
                case 2: // 信道噪声 - 左侧
                    tooltipTop = rect.top;
                    tooltipLeft = rect.left - 315;
                    arrow = 'right';
                    break;
                case 3: // 模式切换 - 右侧
                    tooltipTop = rect.top;
                    tooltipLeft = rect.right + 15;
                    arrow = 'left';
                    break;
                case 4: // 提示词输入框 - 上方
                    tooltipTop = rect.top - 210;
                    tooltipLeft = rect.left + rect.width / 2 - 150;
                    arrow = 'bottom';
                    break;
            }

            setPosition({ top: tooltipTop, left: tooltipLeft });
            setArrowPosition(arrow);
        }
    }, [targetRef, isOpen, step]);

    const getTooltipContent = () => {
        const content = {
            1: {
                zh: '点击设置按钮可以配置系统参数，包括 API Key、载荷内容（Payload）和自定义查询等。您可以在模拟模式和实时模式之间切换。',
                en: 'Click the Settings button to configure system parameters, including API Key, Payload content, and custom queries. You can switch between Simulation mode and Live mode.'
            },
            2: {
                zh: '信道噪声控制用于模拟网络丢包情况。拖动滑块调整丢包率（0-50%），观察水印解码在不同噪声环境下的鲁棒性表现。',
                en: 'Channel Noise control simulates network packet loss. Drag the slider to adjust loss rate (0-50%) and observe watermark decoding robustness under different noise conditions.'
            },
            3: {
                zh: 'Standard 模式用于查看单个对话的完整执行流程；Compare 模式可以对比两个模型的输出结果，并进行评估打分。',
                en: 'Standard mode displays the complete execution flow of a single conversation; Compare mode allows comparison between two model outputs with evaluation scoring.'
            },
            4: {
                zh: '在提示词输入框中输入新的指令，可以继续与 Agent 进行多轮对话。系统会实时显示每一步的执行过程和水印嵌入情况。',
                en: 'Enter new prompts in the input box to continue multi-turn conversations with the Agent. The system displays real-time execution steps and watermark embedding status.'
            }
        };
        
        return content[step as keyof typeof content]?.[locale] || '';
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* 遮罩层 - 阻止点击其他区域 */}
                    <div 
                        className="fixed inset-0 z-[200]"
                        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
                    />

                    {/* 提示框 */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="fixed z-[201] bg-white rounded-2xl shadow-2xl p-5 w-[300px]"
                        style={{
                            top: `${position.top}px`,
                            left: `${position.left}px`,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 尖角 */}
                        <div
                            className="absolute w-0 h-0"
                            style={{
                                ...(arrowPosition === 'top' && {
                                    top: '-10px',
                                    left: '110px',
                                    borderLeft: '10px solid transparent',
                                    borderRight: '10px solid transparent',
                                    borderBottom: '10px solid white',
                                }),
                                ...(arrowPosition === 'bottom' && {
                                    bottom: '-10px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    borderLeft: '10px solid transparent',
                                    borderRight: '10px solid transparent',
                                    borderTop: '10px solid white',
                                }),
                                ...(arrowPosition === 'left' && {
                                    left: '-10px',
                                    top: '20px',
                                    borderTop: '10px solid transparent',
                                    borderBottom: '10px solid transparent',
                                    borderRight: '10px solid white',
                                }),
                                ...(arrowPosition === 'right' && {
                                    right: '-10px',
                                    top: '20px',
                                    borderTop: '10px solid transparent',
                                    borderBottom: '10px solid transparent',
                                    borderLeft: '10px solid white',
                                }),
                            }}
                        />

                        {/* 步骤指示 */}
                        <div className="flex items-center gap-2 mb-3">
                            <span className="bg-indigo-100 text-indigo-600 text-xs font-bold px-2 py-1 rounded">
                                {step}/{totalSteps}
                            </span>
                            <span className="text-xs text-slate-400">{locale === 'zh' ? '操作指南' : 'Tutorial'}</span>
                        </div>

                        {/* 内容 */}
                        <p className="text-sm text-slate-700 leading-relaxed mb-4">
                            {getTooltipContent()}
                        </p>

                        {/* 按钮组 */}
                        <div className="flex justify-between items-center gap-3">
                            <button
                                onClick={onSkip}
                                className="px-4 py-2 text-slate-500 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors"
                            >
                                {locale === 'zh' ? '跳过' : 'Skip'}
                            </button>
                            <button
                                onClick={onNext}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                                {locale === 'zh' ? '明白了' : 'Got it'}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default TutorialTooltip;
