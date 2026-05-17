const MAX_LABEL_LENGTH = 30;

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionArgs {
  questions: Question[];
}

function truncateLabel(label: string, maxLength: number = MAX_LABEL_LENGTH): string {
  if (label.length <= maxLength) {
    return label;
  }
  return label.substring(0, maxLength - 3) + "...";
}

function truncateQuestionLabels(args: AskUserQuestionArgs): AskUserQuestionArgs {
  if (!args.questions || !Array.isArray(args.questions)) {
    return args;
  }

  return {
    ...args,
    questions: args.questions.map((question) => ({
      ...question,
      options:
        question.options?.map((option) => ({
          ...option,
          label: truncateLabel(option.label),
        })) ?? [],
    })),
  };
}

function hasQuestions(args: Record<string, unknown>): args is Record<string, unknown> & AskUserQuestionArgs {
  return Array.isArray(args.questions);
}

export function createQuestionLabelTruncatorHook() {
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolName = input.tool?.toLowerCase();

      if (toolName === "askuserquestion" || toolName === "ask_user_question") {
        if (hasQuestions(output.args)) {
          const truncatedArgs = truncateQuestionLabels(output.args);
          Object.assign(output.args, truncatedArgs);
        }
      }
    },
  };
}
