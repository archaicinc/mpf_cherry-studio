// Tiny in-memory map of workflowTaskId -> name, populated when tasks are
// fetched, so the top-layout tab bar can title a workflow-task tab without
// re-fetching. Ephemeral by design (cleared on reload).
const names = new Map<string, string>()

export const setWorkflowTaskName = (id: string, name: string): void => {
  names.set(id, name)
}

export const getWorkflowTaskName = (id: string): string | undefined => names.get(id)
