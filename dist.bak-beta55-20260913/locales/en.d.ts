declare const locales: {
    readonly "toast.new_background_task": "New Background Task";
    readonly "toast.new_task_executed": "New Task Executed";
    readonly "toast.task_completed": "Task Completed";
    readonly "toast.task_completion_message": "\"{{description}}\" finished in {{duration}}";
    readonly "toast.task_completion_remaining": "Still running: {{running}} | Queued: {{queued}}";
    readonly "toast.status_queued": "Queued";
    readonly "toast.task_list_running": "Running ({{count}}):";
    readonly "toast.task_list_queued": "Queued ({{count}}):";
    readonly "toast.task_list_new": " ← NEW";
    readonly "toast.fallback_prefix": "[FALLBACK] Model: {{model}}{{suffix}}";
    readonly "toast.fallback_inherited": " (inherited from parent)";
    readonly "toast.fallback_system_default": " (system default fallback)";
    readonly "toast.fallback_runtime": " (runtime fallback)";
    readonly "toast.concurrency_info": " [{{total}}/{{limit}}]";
};
export type TranslationKey = keyof typeof locales;
export default locales;
