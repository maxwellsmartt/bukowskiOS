import { useState } from "react";
import { Bell, CalendarClock, Check, CheckCheck, Clock3, ExternalLink, Inbox as InboxIcon, ListTodo, Pencil, Plus, Trash2, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useNotifications } from "@app/providers/NotificationsProvider";
import { AgentCreatedBadge } from "@shared/components/AgentCreatedBadge";
import { useLocale } from "@shared/hooks/useLocale";

const LONG_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const SHORT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const recurrenceOptions = [
  { labelKey: "inbox.recurrence.oneTime", value: "" },
  { labelKey: "inbox.recurrence.everyDay", value: "FREQ=DAILY" },
  { labelKey: "inbox.recurrence.weekdays", value: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR" },
  { labelKey: "inbox.recurrence.everyWeek", value: "FREQ=WEEKLY" },
  { labelKey: "inbox.recurrence.everyMonth", value: "FREQ=MONTHLY" },
] as const;

const getRecurrenceLabel = (rule: string | null | undefined, t: TFunction) => {
  if (!rule) return t("inbox.recurrence.oneTime");
  const option = recurrenceOptions.find((nextOption) => nextOption.value === rule);
  return option ? t(option.labelKey) : t("inbox.recurrence.repeats");
};

const isLicenseReminder = (title: string) => title.startsWith("License renewal:");

const getDueTone = (value: string | null) => {
  if (!value) return "neutral";
  const diff = new Date(value).getTime() - Date.now();
  if (diff < 0) return "critical";
  if (diff < 24 * 60 * 60 * 1000) return "warning";
  return "info";
};

const getCardTone = (value: string | null, completedAt: string | null) => {
  if (completedAt) return "done";
  return getDueTone(value) === "critical" ? "past-due" : "active";
};

const toDateTimeLocalValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

export const InboxPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatDate } = useLocale();
  const {
    createReminder,
    createTodo,
    deleteReminder,
    deleteTodo,
    items,
    isLoading,
    markAllRead,
    markRead,
    markReminderDone,
    markTodoDone,
    reminders,
    snoozeReminder,
    todos,
    unreadCount,
    updateReminder,
    updateTodo,
  } = useNotifications();
  const [activeTab, setActiveTab] = useState<"notifications" | "todos" | "reminders">("notifications");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDueAt, setTodoDueAt] = useState("");
  const [todoRecurrenceRule, setTodoRecurrenceRule] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [reminderRecurrenceRule, setReminderRecurrenceRule] = useState("");
  const [reminderBody, setReminderBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoTitle, setEditingTodoTitle] = useState("");
  const [editingTodoDueAt, setEditingTodoDueAt] = useState("");
  const [editingTodoRecurrenceRule, setEditingTodoRecurrenceRule] = useState("");
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [editingReminderTitle, setEditingReminderTitle] = useState("");
  const [editingReminderAt, setEditingReminderAt] = useState("");
  const [editingReminderRecurrenceRule, setEditingReminderRecurrenceRule] = useState("");
  const [editingReminderBody, setEditingReminderBody] = useState("");
  const openTodos = todos.filter((todo) => !todo.completedAt);
  const pendingReminders = reminders.filter((reminder) => !reminder.completedAt);
  const nextReminder = pendingReminders[0] ?? null;

  const openNotification = async (item: (typeof items)[number]) => {
    if (!item.readAt) {
      await markRead(item.id).catch(() => undefined);
    }

    if (item.linkTo) {
      navigate(item.linkTo);
    }
  };

  const handleCreateTodo = async () => {
    const title = todoTitle.trim();
    if (!title) {
      setFormError(t("inbox.errors.todoTitle"));
      return;
    }

    await createTodo({
      title,
      dueAt: todoDueAt ? new Date(todoDueAt).toISOString() : null,
      recurrenceRule: todoRecurrenceRule || null,
    });
    setTodoTitle("");
    setTodoDueAt("");
    setTodoRecurrenceRule("");
    setFormError(null);
  };

  const startEditingTodo = (todo: (typeof todos)[number]) => {
    setEditingTodoId(todo.id);
    setEditingTodoTitle(todo.title);
    setEditingTodoDueAt(toDateTimeLocalValue(todo.dueAt));
    setEditingTodoRecurrenceRule(todo.recurrenceRule ?? "");
  };

  const saveEditingTodo = async () => {
    if (!editingTodoId || !editingTodoTitle.trim()) {
      setFormError(t("inbox.errors.todoTitle"));
      return;
    }

    await updateTodo({
      id: editingTodoId,
      title: editingTodoTitle.trim(),
      dueAt: editingTodoDueAt ? new Date(editingTodoDueAt).toISOString() : null,
      recurrenceRule: editingTodoRecurrenceRule || null,
    });
    setEditingTodoId(null);
    setFormError(null);
  };

  const startEditingReminder = (reminder: (typeof reminders)[number]) => {
    setEditingReminderId(reminder.id);
    setEditingReminderTitle(reminder.title);
    setEditingReminderAt(toDateTimeLocalValue(reminder.remindAt));
    setEditingReminderRecurrenceRule(reminder.recurrenceRule ?? "");
    setEditingReminderBody(reminder.body ?? "");
  };

  const saveEditingReminder = async () => {
    if (!editingReminderId || !editingReminderTitle.trim() || !editingReminderAt) {
      setFormError(t("inbox.errors.reminderTitleTime"));
      return;
    }

    await updateReminder({
      id: editingReminderId,
      title: editingReminderTitle.trim(),
      body: editingReminderBody.trim() || null,
      remindAt: new Date(editingReminderAt).toISOString(),
      recurrenceRule: editingReminderRecurrenceRule || null,
    });
    setEditingReminderId(null);
    setFormError(null);
  };

  const handleCreateReminder = async () => {
    const title = reminderTitle.trim();
    if (!title || !reminderAt) {
      setFormError(t("inbox.errors.reminderTitleTime"));
      return;
    }

    await createReminder({
      title,
      body: reminderBody.trim() || null,
      remindAt: new Date(reminderAt).toISOString(),
      recurrenceRule: reminderRecurrenceRule || null,
    });
    setReminderTitle("");
    setReminderAt("");
    setReminderRecurrenceRule("");
    setReminderBody("");
    setFormError(null);
  };

  return (
    <section className="page-stack inbox-page">
      <header className="inbox-hero">
        <div>
          <h1>{t("inbox.title")}</h1>
        </div>
        <div className="inbox-hero-status">
          <button className="secondary-button inbox-mark-all-button" disabled={unreadCount === 0} onClick={() => void markAllRead()} type="button">
            <CheckCheck size={14} />
            <span>{t("inbox.actions.markAllRead")}</span>
          </button>
        </div>
      </header>

      <div className="inbox-summary-grid">
        <article className={unreadCount > 0 ? "is-hot" : ""}>
          <span>{t("inbox.summary.unread")}</span>
          <strong>{unreadCount}</strong>
          <small>{unreadCount ? t("inbox.summary.needsAttention") : t("inbox.summary.allCaughtUp")}</small>
        </article>
        <article>
          <span>{t("inbox.summary.openTodos")}</span>
          <strong>{openTodos.length}</strong>
          <small>{t("inbox.summary.totalVisible", { count: todos.length })}</small>
        </article>
        <article>
          <span>{t("inbox.summary.nextReminder")}</span>
          <strong>{nextReminder ? formatDate(nextReminder.remindAt, SHORT_DATE_FORMAT) : t("common.none")}</strong>
          <small>{t("inbox.summary.scheduled", { count: pendingReminders.length })}</small>
        </article>
      </div>

      <section className="surface-panel inbox-panel">
        <div className={`inbox-panel-header inbox-panel-header-${activeTab}`}>
          <button className={activeTab === "notifications" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("notifications")} type="button">
            <Bell size={15} />
            <span>
              <strong>{t("inbox.tabs.notifications")}</strong>
              <small>{t("inbox.tabs.unread", { count: unreadCount })}</small>
            </span>
          </button>
          <button className={activeTab === "todos" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("todos")} type="button">
            <ListTodo size={15} />
            <span>
              <strong>{t("inbox.tabs.todos")}</strong>
              <small>{t("inbox.tabs.open", { count: openTodos.length })}</small>
            </span>
          </button>
          <button className={activeTab === "reminders" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("reminders")} type="button">
            <Clock3 size={15} />
            <span>
              <strong>{t("inbox.tabs.reminders")}</strong>
              <small>{t("inbox.tabs.scheduled", { count: pendingReminders.length })}</small>
            </span>
          </button>
        </div>

        <div key={activeTab} className={`inbox-tab-pane inbox-tab-pane-${activeTab}`}>
          {formError ? <div className="inline-form-error">{formError}</div> : null}

          {activeTab === "notifications" && isLoading ? (
          <div className="notifications-empty">
            <InboxIcon size={18} />
            <span>{t("inbox.notifications.loading")}</span>
          </div>
        ) : activeTab === "notifications" && items.length === 0 ? (
          <div className="notifications-empty inbox-empty-state">
            <Bell size={22} />
            <strong>{t("inbox.notifications.emptyTitle")}</strong>
            <span>{t("inbox.notifications.emptyBody")}</span>
          </div>
        ) : activeTab === "notifications" ? (
          <div className="inbox-list">
            {items.map((item) => (
              <button
                key={item.id}
                className={`inbox-row${item.readAt ? "" : " is-unread"}`}
                onClick={() => void openNotification(item)}
                type="button"
              >
                <span className="inbox-row-icon">
                  <Bell size={14} />
                </span>
                <span className="inbox-row-copy">
                  <span>{formatDate(item.createdAt, LONG_DATE_FORMAT)}</span>
                  <strong className="inbox-copy-title">
                    <span>{item.title}</span>
                  </strong>
                  {item.body ? <span>{item.body}</span> : null}
                </span>
                <span className="inbox-row-indicators">
                  {item.sourceType === "agent" ? <AgentCreatedBadge variant="table" /> : null}
                  {item.linkTo ? <ExternalLink size={14} /> : null}
                </span>
              </button>
            ))}
          </div>
        ) : activeTab === "todos" ? (
          <div className="inbox-list">
            <div className="inbox-composer">
              <div>
                <p className="inbox-composer-title">{t("inbox.quickAdd")}</p>
              </div>
              <div className="inbox-quick-form">
                <input aria-label={t("inbox.todos.titleAria")} value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder={t("inbox.todos.placeholder")} />
                <input aria-label={t("inbox.todos.dueDateAria")} value={todoDueAt} onChange={(event) => setTodoDueAt(event.target.value)} type="datetime-local" />
                <select aria-label={t("inbox.todos.frequencyAria")} value={todoRecurrenceRule} onChange={(event) => setTodoRecurrenceRule(event.target.value)}>
                  {recurrenceOptions.map((option) => (
                    <option key={option.value || "one-time"} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                <button className="inbox-add-button" onClick={() => void handleCreateTodo()} type="button">
                  <Plus size={14} />
                  <span>{t("inbox.todos.add")}</span>
                </button>
              </div>
            </div>
            {todos.length ? (
              <div className="inbox-card-grid">
                {todos.map((todo) => {
                  const isEditing = editingTodoId === todo.id;
                  return (
                    <article key={todo.id} className={`inbox-task-card tone-${getCardTone(todo.dueAt, todo.completedAt)}`}>
                      {todo.createdBy === "agent" ? <AgentCreatedBadge variant="corner" /> : null}
                      <div className="inbox-task-card-header">
                        <span className="inbox-row-icon">
                          <ListTodo size={14} />
                        </span>
                        <span className={`inbox-meta-pill tone-${getDueTone(todo.dueAt)}`}>
                          {todo.dueAt ? t("inbox.todos.due", { date: formatDate(todo.dueAt, SHORT_DATE_FORMAT) }) : t("inbox.todos.noDueDate")}
                        </span>
                        {todo.recurrenceRule ? <span className="inbox-meta-pill tone-info">{getRecurrenceLabel(todo.recurrenceRule, t)}</span> : null}
                      </div>
                      {isEditing ? (
                        <div className="inbox-edit-form">
                          <input aria-label={t("inbox.todos.titleAria")} value={editingTodoTitle} onChange={(event) => setEditingTodoTitle(event.target.value)} />
                          <input aria-label={t("inbox.todos.dueDateAria")} value={editingTodoDueAt} onChange={(event) => setEditingTodoDueAt(event.target.value)} type="datetime-local" />
                          <select aria-label={t("inbox.todos.frequencyAria")} value={editingTodoRecurrenceRule} onChange={(event) => setEditingTodoRecurrenceRule(event.target.value)}>
                            {recurrenceOptions.map((option) => (
                              <option key={option.value || "one-time"} value={option.value}>
                                {t(option.labelKey)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="inbox-task-card-copy">
                          <strong className="inbox-copy-title">
                            <span>{todo.title}</span>
                          </strong>
                          {todo.notes ? <span>{todo.notes}</span> : <span>{t("inbox.noNotes")}</span>}
                        </div>
                      )}
                      <div className="inbox-task-card-actions">
                        {isEditing ? (
                          <>
                            <button className="inbox-cancel-button" onClick={() => setEditingTodoId(null)} type="button">
                              <X size={13} />
                              {t("common.cancel")}
                            </button>
                            <button className="inbox-add-button compact" onClick={() => void saveEditingTodo()} type="button">
                              <Check size={13} />
                              {t("common.save")}
                            </button>
                          </>
                        ) : (
                          <>
                            {!todo.completedAt ? (
                              <button className="inbox-card-done-button" onClick={() => void markTodoDone(todo.id)} type="button">
                                <Check size={14} />
                                <span>{t("inbox.actions.done")}</span>
                              </button>
                            ) : null}
                            <span className="inbox-card-hover-actions">
                              <button className="icon-ghost-control" data-tooltip={t("common.edit")} onClick={() => startEditingTodo(todo)} type="button">
                                <Pencil size={14} />
                              </button>
                              <button className="icon-ghost-control danger-icon-control" data-tooltip={t("common.delete")} onClick={() => void deleteTodo(todo.id)} type="button">
                                <Trash2 size={14} />
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="notifications-empty inbox-empty-state">
                <ListTodo size={22} />
                <strong>{t("inbox.todos.emptyTitle")}</strong>
                <span>{t("inbox.todos.emptyBody")}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="inbox-list">
            <div className="inbox-composer">
              <div>
                <p className="inbox-composer-title">{t("inbox.quickAdd")}</p>
              </div>
              <div className="inbox-quick-form inbox-reminder-form">
                <input aria-label={t("inbox.reminders.titleAria")} value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} placeholder={t("inbox.reminders.placeholder")} />
                <input aria-label={t("inbox.reminders.timeAria")} value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} type="datetime-local" />
                <select aria-label={t("inbox.reminders.frequencyAria")} value={reminderRecurrenceRule} onChange={(event) => setReminderRecurrenceRule(event.target.value)}>
                  {recurrenceOptions.map((option) => (
                    <option key={option.value || "one-time"} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                <input aria-label={t("inbox.reminders.notesAria")} value={reminderBody} onChange={(event) => setReminderBody(event.target.value)} placeholder={t("inbox.reminders.notesPlaceholder")} />
                <button className="inbox-add-button" onClick={() => void handleCreateReminder()} type="button">
                  <Plus size={14} />
                  <span>{t("inbox.reminders.add")}</span>
                </button>
              </div>
            </div>
            {reminders.length ? (
              <div className="inbox-card-grid">
                {reminders.map((reminder) => {
                  const isEditing = editingReminderId === reminder.id;
                  const reminderMeta = reminder.completedAt
                    ? t("inbox.reminders.delivered")
                    : reminder.snoozedUntil
                      ? t("inbox.reminders.snoozedUntil", { date: formatDate(reminder.snoozedUntil, SHORT_DATE_FORMAT) })
                      : t("inbox.reminders.reminds", { date: formatDate(reminder.remindAt, SHORT_DATE_FORMAT) });
                  return (
                    <article
                      key={reminder.id}
                      className={`inbox-task-card tone-${getCardTone(reminder.snoozedUntil ?? reminder.remindAt, reminder.completedAt)}`}
                    >
                      {reminder.createdBy === "agent" ? <AgentCreatedBadge variant="corner" /> : null}
                      <div className="inbox-task-card-header">
                        <span className="inbox-row-icon">
                          <CalendarClock size={14} />
                        </span>
                        <span className={`inbox-meta-pill tone-${reminder.completedAt ? "neutral" : getDueTone(reminder.snoozedUntil ?? reminder.remindAt)}`}>
                          {reminderMeta}
                        </span>
                        {isLicenseReminder(reminder.title) ? <span className="inbox-meta-pill tone-info">{t("inbox.reminders.licenses")}</span> : null}
                        {reminder.recurrenceRule ? <span className="inbox-meta-pill tone-info">{getRecurrenceLabel(reminder.recurrenceRule, t)}</span> : null}
                      </div>
                      {isEditing ? (
                        <div className="inbox-edit-form">
                          <input aria-label={t("inbox.reminders.titleAria")} value={editingReminderTitle} onChange={(event) => setEditingReminderTitle(event.target.value)} />
                          <input aria-label={t("inbox.reminders.timeAria")} value={editingReminderAt} onChange={(event) => setEditingReminderAt(event.target.value)} type="datetime-local" />
                          <select aria-label={t("inbox.reminders.frequencyAria")} value={editingReminderRecurrenceRule} onChange={(event) => setEditingReminderRecurrenceRule(event.target.value)}>
                            {recurrenceOptions.map((option) => (
                              <option key={option.value || "one-time"} value={option.value}>
                                {t(option.labelKey)}
                              </option>
                            ))}
                          </select>
                          <input aria-label={t("inbox.reminders.bodyAria")} value={editingReminderBody} onChange={(event) => setEditingReminderBody(event.target.value)} />
                        </div>
                      ) : (
                        <div className="inbox-task-card-copy">
                          <strong className="inbox-copy-title">
                            <span>{reminder.title}</span>
                          </strong>
                          {reminder.body ? <span>{reminder.body}</span> : <span>{t("inbox.noNotes")}</span>}
                        </div>
                      )}
                      <div className="inbox-task-card-actions">
                        {isEditing ? (
                          <>
                            <button className="inbox-cancel-button" onClick={() => setEditingReminderId(null)} type="button">
                              <X size={13} />
                              {t("common.cancel")}
                            </button>
                            <button className="inbox-add-button compact" onClick={() => void saveEditingReminder()} type="button">
                              <Check size={13} />
                              {t("common.save")}
                            </button>
                          </>
                        ) : (
                          <>
                            {!reminder.completedAt ? (
                              <>
                                <button className="secondary-button compact" onClick={() => void snoozeReminder(reminder.id, 15)} type="button">
                                  {t("inbox.actions.snooze")}
                                </button>
                                <button className="inbox-card-done-button" onClick={() => void markReminderDone(reminder.id)} type="button">
                                  <Check size={14} />
                                  <span>{t("inbox.actions.done")}</span>
                                </button>
                              </>
                            ) : null}
                            <span className="inbox-card-hover-actions">
                              <button className="icon-ghost-control" data-tooltip={t("common.edit")} onClick={() => startEditingReminder(reminder)} type="button">
                                <Pencil size={14} />
                              </button>
                              <button className="icon-ghost-control danger-icon-control" data-tooltip={t("common.delete")} onClick={() => void deleteReminder(reminder.id)} type="button">
                                <Trash2 size={14} />
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="notifications-empty inbox-empty-state">
                <Clock3 size={22} />
                <strong>{t("inbox.reminders.emptyTitle")}</strong>
                <span>{t("inbox.reminders.emptyBody")}</span>
              </div>
            )}
          </div>
          )}
        </div>
      </section>
    </section>
  );
};
