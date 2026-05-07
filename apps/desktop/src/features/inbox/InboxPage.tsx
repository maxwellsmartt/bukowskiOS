import { useState } from "react";
import { Bell, CalendarClock, Check, CheckCheck, Clock3, ExternalLink, Inbox as InboxIcon, ListTodo, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useNotifications } from "@app/providers/NotificationsProvider";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const getDueTone = (value: string | null) => {
  if (!value) return "neutral";
  const diff = new Date(value).getTime() - Date.now();
  if (diff < 0) return "critical";
  if (diff < 24 * 60 * 60 * 1000) return "warning";
  return "info";
};

export const InboxPage = () => {
  const navigate = useNavigate();
  const {
    createReminder,
    createTodo,
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
  } = useNotifications();
  const [activeTab, setActiveTab] = useState<"notifications" | "todos" | "reminders">("notifications");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDueAt, setTodoDueAt] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [reminderBody, setReminderBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
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
      setFormError("Add a todo title first.");
      return;
    }

    await createTodo({
      title,
      dueAt: todoDueAt ? new Date(todoDueAt).toISOString() : null,
    });
    setTodoTitle("");
    setTodoDueAt("");
    setFormError(null);
  };

  const handleCreateReminder = async () => {
    const title = reminderTitle.trim();
    if (!title || !reminderAt) {
      setFormError("Add a reminder title and time first.");
      return;
    }

    await createReminder({
      title,
      body: reminderBody.trim() || null,
      remindAt: new Date(reminderAt).toISOString(),
    });
    setReminderTitle("");
    setReminderAt("");
    setReminderBody("");
    setFormError(null);
  };

  return (
    <section className="page-stack inbox-page">
      <header className="inbox-hero">
        <div>
          <p className="section-eyebrow">Operations Inbox</p>
          <h1>Inbox</h1>
          <p>Agent updates, reminders and personal follow-ups for this workspace.</p>
        </div>
        <div className="inbox-hero-status">
          <span className="inbox-native-pill">
            <Sparkles size={13} />
            macOS native alerts
          </span>
          <button className="secondary-button" disabled={unreadCount === 0} onClick={() => void markAllRead()} type="button">
            <CheckCheck size={14} />
            <span>Mark all read</span>
          </button>
        </div>
      </header>

      <div className="inbox-summary-grid">
        <article className={unreadCount > 0 ? "is-hot" : ""}>
          <span>Unread</span>
          <strong>{unreadCount}</strong>
          <small>{unreadCount ? "Needs attention" : "All caught up"}</small>
        </article>
        <article>
          <span>Open todos</span>
          <strong>{openTodos.length}</strong>
          <small>{todos.length} total visible</small>
        </article>
        <article>
          <span>Next reminder</span>
          <strong>{nextReminder ? shortDateFormatter.format(new Date(nextReminder.remindAt)) : "None"}</strong>
          <small>{pendingReminders.length} scheduled</small>
        </article>
      </div>

      <section className="surface-panel inbox-panel">
        <div className="inbox-panel-header">
          <button className={activeTab === "notifications" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("notifications")} type="button">
            <Bell size={15} />
            <span>
              <strong>Notifications</strong>
              <small>{unreadCount} unread</small>
            </span>
          </button>
          <button className={activeTab === "todos" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("todos")} type="button">
            <ListTodo size={15} />
            <span>
              <strong>Todos</strong>
              <small>{openTodos.length} open</small>
            </span>
          </button>
          <button className={activeTab === "reminders" ? "inbox-tab is-active" : "inbox-tab"} onClick={() => setActiveTab("reminders")} type="button">
            <Clock3 size={15} />
            <span>
              <strong>Reminders</strong>
              <small>{pendingReminders.length} scheduled</small>
            </span>
          </button>
        </div>

        {formError ? <div className="inline-form-error">{formError}</div> : null}

        {activeTab === "notifications" && isLoading ? (
          <div className="notifications-empty">
            <InboxIcon size={18} />
            <span>Loading notifications…</span>
          </div>
        ) : activeTab === "notifications" && items.length === 0 ? (
          <div className="notifications-empty inbox-empty-state">
            <Bell size={22} />
            <strong>No notifications yet</strong>
            <span>When an agent finishes work, a reminder fires or a workspace event needs attention, it will appear here.</span>
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
                  <span>{dateFormatter.format(new Date(item.createdAt))}</span>
                  <strong>{item.title}</strong>
                  {item.body ? <span>{item.body}</span> : null}
                </span>
                {item.linkTo ? <ExternalLink size={14} /> : null}
              </button>
            ))}
          </div>
        ) : activeTab === "todos" ? (
          <div className="inbox-list">
            <div className="inbox-composer">
              <div>
                <p className="section-eyebrow">Quick add</p>
                <strong>New todo</strong>
              </div>
              <div className="inbox-quick-form">
                <input aria-label="Todo title" value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="What needs to happen?" />
                <input aria-label="Todo due date" value={todoDueAt} onChange={(event) => setTodoDueAt(event.target.value)} type="datetime-local" />
                <button className="primary-button" onClick={() => void handleCreateTodo()} type="button">
                  <Plus size={14} />
                  <span>Add</span>
                </button>
              </div>
            </div>
            {todos.length ? (
              todos.map((todo) => (
                <div key={todo.id} className={`inbox-row inbox-row-static${todo.completedAt ? "" : " is-unread"}`}>
                  <span className="inbox-row-icon">
                    <ListTodo size={14} />
                  </span>
                  <span className="inbox-row-copy">
                    <span className={`inbox-meta-pill tone-${getDueTone(todo.dueAt)}`}>
                      {todo.dueAt ? `Due ${shortDateFormatter.format(new Date(todo.dueAt))}` : "No due date"}
                    </span>
                    <strong>{todo.title}</strong>
                    {todo.notes ? <span>{todo.notes}</span> : null}
                  </span>
                  {!todo.completedAt ? (
                    <button className="icon-ghost-control" data-tooltip="Mark done" onClick={() => void markTodoDone(todo.id)} type="button">
                      <Check size={14} />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="notifications-empty inbox-empty-state">
                <ListTodo size={22} />
                <strong>No todos yet</strong>
                <span>Add one above or ask an agent to create a follow-up.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="inbox-list">
            <div className="inbox-composer">
              <div>
                <p className="section-eyebrow">Quick add</p>
                <strong>New reminder</strong>
              </div>
              <div className="inbox-quick-form inbox-reminder-form">
                <input aria-label="Reminder title" value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} placeholder="Remind me to…" />
                <input aria-label="Reminder time" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} type="datetime-local" />
                <input aria-label="Reminder notes" value={reminderBody} onChange={(event) => setReminderBody(event.target.value)} placeholder="Notes optional" />
                <button className="primary-button" onClick={() => void handleCreateReminder()} type="button">
                  <Plus size={14} />
                  <span>Add</span>
                </button>
              </div>
            </div>
            {reminders.length ? (
              reminders.map((reminder) => (
                <div key={reminder.id} className={`inbox-row inbox-row-static${reminder.completedAt ? "" : " is-unread"}`}>
                  <span className="inbox-row-icon">
                    <CalendarClock size={14} />
                  </span>
                  <span className="inbox-row-copy">
                    <span className={`inbox-meta-pill tone-${reminder.completedAt ? "neutral" : getDueTone(reminder.snoozedUntil ?? reminder.remindAt)}`}>
                      {reminder.completedAt
                        ? "Delivered"
                        : reminder.snoozedUntil
                          ? `Snoozed until ${shortDateFormatter.format(new Date(reminder.snoozedUntil))}`
                          : `Reminds ${shortDateFormatter.format(new Date(reminder.remindAt))}`}
                    </span>
                    <strong>{reminder.title}</strong>
                    {reminder.body ? <span>{reminder.body}</span> : null}
                  </span>
                  {!reminder.completedAt ? (
                    <span className="inbox-row-actions">
                      <button className="secondary-button compact" onClick={() => void snoozeReminder(reminder.id, 15)} type="button">
                        Snooze
                      </button>
                      <button className="icon-ghost-control" data-tooltip="Mark done" onClick={() => void markReminderDone(reminder.id)} type="button">
                        <Check size={14} />
                      </button>
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="notifications-empty inbox-empty-state">
                <Clock3 size={22} />
                <strong>No reminders yet</strong>
                <span>Scheduled reminders will fire natively on macOS.</span>
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
};
