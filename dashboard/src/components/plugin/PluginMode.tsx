import React from 'react';

type PluginModeProps = {
    onHome: () => void;
};

const PluginMode: React.FC<PluginModeProps> = ({ onHome }) => {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <h1 className="text-2xl font-bold text-slate-900">Plugin Mode</h1>
                <p className="mt-3 text-sm text-slate-600">
                    Plugin mode has been deprecated in this build. Please use the “Add your agent”
                    flow on the welcome screen to launch the external-agent dashboard.
                </p>
                <button
                    type="button"
                    onClick={onHome}
                    className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
                >
                    Back to Home
                </button>
            </div>
        </div>
    );
};

export default PluginMode;
