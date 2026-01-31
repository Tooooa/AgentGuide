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
    mode?: 'standard' | 'compare'; // Add mode property
}

const TutorialTooltip: React.FC<TutorialTooltipProps> = ({
    isOpen,
    step,
    totalSteps,
    onNext,
    onSkip,
    targetRef,
    mode = 'standard' // Default to standard mode
}) => {
    const [position, setPosition] = React.useState({ top: 0, left: 0 });
    const [arrowPosition, setArrowPosition] = React.useState<'top' | 'bottom' | 'left' | 'right'>('top');
    const { locale } = useI18n();

    React.useEffect(() => {
        if (targetRef?.current && isOpen) {
            const rect = targetRef.current.getBoundingClientRect();
            console.log('Tutorial tooltip - mode:', mode, 'step:', step);
            console.log('  rect.top:', rect.top, 'rect.left:', rect.left, 'rect.right:', rect.right, 'rect.bottom:', rect.bottom);
            console.log('  rect.width:', rect.width, 'rect.height:', rect.height);

            // Determine tooltip position based on step
            let tooltipTop = 0;
            let tooltipLeft = 0;
            let arrow: 'top' | 'bottom' | 'left' | 'right' = 'top';

            if (mode === 'compare') {
                // Calculate position for Compare mode
                switch (step) {
                    case 1: // EVALUATING area - middle right of screen
                        tooltipTop = rect.top + 40;
                        tooltipLeft = rect.left + 30;
                        arrow = 'left';
                        break;
                    case 2: // Utility Monitor - right side
                        tooltipTop = rect.top + 10;
                        tooltipLeft = rect.right + 30;
                        arrow = 'left';
                        break;
                    case 3: // Chart bar graph - left side
                        tooltipTop = rect.top + 50;
                        tooltipLeft = rect.left - 320;
                        arrow = 'right';
                        break;
                }
            } else {
                // Calculate position for Standard mode
                switch (step) {
                    case 1: // Settings button - below
                        tooltipTop = rect.bottom + 15;
                        tooltipLeft = rect.left - 80;
                        arrow = 'top';
                        break;
                    case 2: // Channel noise - left side
                        tooltipTop = rect.top;
                        tooltipLeft = rect.left - 315;
                        arrow = 'right';
                        break;
                    case 3: // Mode toggle - right side
                        tooltipTop = rect.top;
                        tooltipLeft = rect.right + 15;
                        arrow = 'left';
                        break;
                    case 4: // Prompt input box - above
                        tooltipTop = rect.top - 210;
                        tooltipLeft = rect.left + rect.width / 2 - 150;
                        arrow = 'bottom';
                        break;
                }
            }

            // Boundary check: prevent tooltip from overflowing screen
            const tooltipWidth = 300; // Tooltip width
            const tooltipHeight = 250; // Approximate tooltip height
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            console.log('  screen size:', screenWidth, 'x', screenHeight);
            console.log('  before boundary check - top:', tooltipTop, 'left:', tooltipLeft, 'arrow:', arrow);

            // If right side doesn't fit, switch to left
            if (arrow === 'left' && tooltipLeft + tooltipWidth > screenWidth) {
                tooltipLeft = rect.left - tooltipWidth - 15;
                arrow = 'right';
                console.log('  adjusted to left side');
            }

            // If left side doesn't fit, keep as is or adjust
            if (arrow === 'right' && tooltipLeft < 0) {
                tooltipLeft = 15;
                console.log('  adjusted left position to avoid negative');
            }

            // If position is off-screen (negative or too large), force display in center
            if (tooltipTop < 0) {
                tooltipTop = 100;
                console.log('  adjusted top to avoid being above screen');
            }
            if (tooltipLeft < 0) {
                tooltipLeft = 50;
                console.log('  adjusted left to avoid being left of screen');
            }

            // If bottom doesn't fit, switch to top
            if (arrow === 'top' && tooltipTop + tooltipHeight > screenHeight) {
                tooltipTop = rect.top - tooltipHeight - 15;
                if (tooltipTop < 0) tooltipTop = 100; // Check again
                arrow = 'bottom';
                console.log('  adjusted to top side');
            }

            // If right side doesn't fit
            if (tooltipLeft + tooltipWidth > screenWidth) {
                tooltipLeft = screenWidth - tooltipWidth - 15;
                console.log('  adjusted left to fit screen width');
            }

            console.log('  calculated position - top:', tooltipTop, 'left:', tooltipLeft, 'arrow:', arrow);
            setPosition({ top: tooltipTop, left: tooltipLeft });
            setArrowPosition(arrow);
        }
    }, [targetRef, isOpen, step, mode]);

    const getTooltipContent = () => {
        if (mode === 'compare') {
            const compareContent = {
                1: {
                    zh: '此区域显示评估结果，展示基线模型（Original）和带水印模型（Ours）的得分对比。点击下方的"开始评估"按钮可进行自动评估。',
                    en: 'This area displays evaluation results, showing score comparison between the baseline model (Original) and watermarked model (Ours). Click "Start Evaluation" below to perform automatic evaluation.'
                },
                2: {
                    zh: 'Utility Monitor 监控区域显示系统性能指标，包括 Token 吞吐量和步骤延迟等关键数据，帮助您了解水印对性能的影响。',
                    en: 'Utility Monitor displays system performance metrics, including Token throughput and step latency, helping you understand the performance impact of watermarking.'
                },
                3: {
                    zh: '柱状图展示采样概率分布的差异。点击柱状图可查看详细的概率分布对比，了解水印如何影响模型的输出分布。',
                    en: 'The bar chart shows sampling probability distribution differences. Click on the chart to view detailed probability distribution comparison and understand how watermarking affects model output distribution.'
                }
            };
            return compareContent[step as keyof typeof compareContent]?.[locale] || '';
        } else {
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
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Overlay - prevent clicking other areas */}
                    <div
                        className="fixed inset-0 z-[200]"
                        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
                    />

                    {/* Tooltip box */}
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
                        {/* Arrow */}
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

                        {/* Step indicator */}
                        <div className="flex items-center gap-2 mb-3">
                            <span className="bg-indigo-100 text-indigo-600 text-xs font-bold px-2 py-1 rounded">
                                {step}/{totalSteps}
                            </span>
                            <span className="text-xs text-slate-400">{locale === 'zh' ? '操作指南' : 'Tutorial'}</span>
                        </div>

                        {/* Content */}
                        <p className="text-sm text-slate-700 leading-relaxed mb-4">
                            {getTooltipContent()}
                        </p>

                        {/* Button group */}
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
