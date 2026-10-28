/*
 * Холст KORT - второй фронт на одних вызовах API модели (этап 2, шаг 7).
 *
 * Вызовы: describe (что есть и что можно), ask (карточка = вопрос), explain
 * (число по ссылке до фактов), propose / apply / undo (правка с последствиями
 * до записи и возврат), changes (живой холст по подписке). Больше ничего:
 * ни одного маршрута экранов.
 *
 * Карточки холста - личное удобство этого браузера (localStorage), не данные
 * компании: виды компании сохраняются командой view.save.
 */
(function () {
  "use strict";

  var API = "/api/backend/api/v1/finance/model";
  var KEY = "kort-canvas-cards";
  var ROWS = 12;
  var GROUP_TITLES = { client: "по клиентам", entity: "по нашим юрлицам", department: "по отделам", person: "по сотрудникам" };
  var KIND_TITLES = {
    payment: "оплата", accrual: "начисление по условию", terms: "условие договора", act: "акт", opening: "входящее сальдо",
    adjustment: "поправка месяца", agreement: "соглашение", table_row: "строка сводной таблицы", bill: "счёт", esf: "ЭСФ", decision: "решение человека",
  };

  var state = { describe: null, cards: [], timer: null, lost: false };
  var board = document.getElementById("board");
  var veil = document.getElementById("veil");
  var dialog = document.getElementById("dialog");

  // ── Вызов ───────────────────────────────────────────────────────────────

  function call(method, path, body) {
    var headers = { "X-Kort-Model": "1" };
    if (body !== undefined) headers["content-type"] = "application/json";
    return fetch(API + path, {
      method: method,
      credentials: "include",
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!response.ok) {
          var detail = data && (data.detail && data.detail.detail ? data.detail.detail : data.detail);
          var error = new Error(typeof detail === "string" ? detail : "Сервер ответил " + response.status);
          error.status = response.status;
          error.body = data;
          throw error;
        }
        return data;
      });
    });
  }

  // ── Мелочи ──────────────────────────────────────────────────────────────

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "text") node.textContent = value;
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function money(value) {
    if (value === null || value === undefined || value === "") return "-";
    var number = Number(value);
    if (!isFinite(number)) return String(value);
    return number.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/ /g, " ");
  }

  function day(iso) {
    if (!iso) return "-";
    var parts = String(iso).slice(0, 10).split("-");
    return parts.length === 3 ? parts[2] + "." + parts[1] + "." + parts[0] : iso;
  }

  function clock(date) {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  /** Число, которое раскрывается: кнопка со ссылкой «объяснить». */
  function number(value, ref) {
    if (!ref || value === null || value === undefined) return h("span", { class: "plain", text: money(value) });
    return h("button", { class: "num", type: "button", title: "Из чего сложилось", onclick: function () { explain([ref]); }, text: money(value) });
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.cards.map(function (card) { return { question: card.question, as_of: card.as_of || "" }; })));
    } catch (e) { /* без хранилища холст просто не запомнится */ }
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "null");
      return Array.isArray(raw) ? raw : null;
    } catch (e) {
      return null;
    }
  }

  // ── Окно по центру ──────────────────────────────────────────────────────

  function openDialog(title, body) {
    dialog.innerHTML = "";
    dialog.appendChild(h("header", {}, [h("h3", { text: title }), h("button", { class: "btn", type: "button", onclick: closeDialog, text: "Закрыть" })]));
    dialog.appendChild(h("div", { class: "body" }, [body]));
    veil.hidden = false;
  }

  function closeDialog() {
    veil.hidden = true;
    dialog.innerHTML = "";
  }

  veil.addEventListener("mousedown", function (event) { if (event.target === veil) closeDialog(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !veil.hidden) closeDialog(); });

  // ── Объяснить ───────────────────────────────────────────────────────────

  function factLine(fact) {
    if (!fact) return null;
    var bits = [KIND_TITLES[fact.kind] || fact.kind || "факт"];
    if (fact.day) bits.push(day(fact.day));
    if (fact.month) bits.push(fact.month);
    if (fact.source && typeof fact.source === "string") bits.push("источник: " + fact.source);
    if (fact.party) bits.push(fact.party);
    if (fact.author) bits.push(fact.author);
    if (fact.number) bits.push("№ " + fact.number);
    if (fact.key) bits.push(fact.key);
    return h("span", { class: "fact", text: bits.join(" · ") });
  }

  function partsList(parts, trail) {
    return h("ul", { class: "parts" }, parts.map(function (part) {
      var label = h("span", { class: "what" }, [part.title, factLine(part.fact)]);
      var value = part.ref
        ? h("button", { class: "num", type: "button", onclick: function () { explain(trail.concat([part.ref])); }, text: money(part.value) })
        : h("span", { class: "plain", text: money(part.value) });
      var row = h("li", {}, [h("span", { class: "sign", text: part.sign === "+" || part.sign === "-" ? part.sign : "" }), label, value]);
      if (part.parts && part.parts.length) row.appendChild(h("div", { class: "inner" }, [partsList(part.parts, trail)]));
      return row;
    }));
  }

  function explain(trail) {
    var ref = trail[trail.length - 1];
    openDialog("Из чего сложилось", h("p", { class: "note", text: "Считаю…" }));
    call("GET", "/explain?ref=" + encodeURIComponent(ref)).then(function (found) {
      var crumbs = trail.length > 1 ? h("div", { class: "crumbs" }, trail.slice(0, -1).map(function (item, index) {
        return h("button", { type: "button", onclick: function () { explain(trail.slice(0, index + 1)); }, text: index === 0 ? "начало" : "шаг " + (index + 1) });
      })) : null;
      var body = h("div", {}, [
        crumbs,
        h("div", { text: found.title }),
        h("div", { class: "value", text: money(found.value) }),
        h("div", { class: "formula", text: found.formula }),
        found.parts.length ? partsList(found.parts, trail) : h("p", { class: "note", text: "Слагаемых нет" }),
        found.parts.length ? h("div", { class: "check", "data-exact": String(found.exact), text: found.exact ? "Слагаемые дают " + money(found.check) + " - число сходится" : "Слагаемые дают " + money(found.check) + ", а число - " + money(found.value) }) : null,
      ]);
      openDialog("Из чего сложилось", body);
    }).catch(function (error) {
      openDialog("Из чего сложилось", h("p", { class: "refusal", text: error.message }));
    });
  }

  // ── Предложить, применить, отменить ─────────────────────────────────────

  function editable() {
    var fields = (state.describe && state.describe.fields) || [];
    // Поля, которые правятся строкой: текст, сумма, дата, число. Списки и стороны - экраном реестра.
    return fields.filter(function (field) {
      return field.editable && ["text", "money", "date", "number"].indexOf(field.type) >= 0;
    });
  }

  function canWrite() {
    var commands = (state.describe && state.describe.commands) || [];
    return commands.some(function (item) { return item.name === "contract.update" && item.open; });
  }

  function changeLines(proposal) {
    var fields = {};
    ((state.describe && state.describe.fields) || []).forEach(function (field) { fields[field.key] = field.title; });
    var lines = [];
    proposal.changes.forEach(function (change) {
      Object.keys(change.fields || {}).forEach(function (key) {
        var item = change.fields[key];
        lines.push((fields[key] || key) + ": " + show(item.before) + " → " + show(item.after));
      });
      if (change.debt) lines.push("долг на сегодня: " + money(change.debt.before) + " → " + money(change.debt.after));
      if (change.facts) {
        var added = change.facts.added.length, ended = change.facts.ended.length;
        if (added || ended) lines.push("факты журнала: " + (added ? "появится " + added : "") + (added && ended ? ", " : "") + (ended ? "снимется " + ended : ""));
      }
      if (change.created) lines.push("заведётся договор");
      if (change.deleted) lines.push("договор уйдёт в корзину");
    });
    return lines.length ? lines : ["ничего не изменится"];
  }

  function show(value) {
    if (value === null || value === undefined || value === "") return "пусто";
    if (typeof value === "object") return value.name || value.title || value.value || JSON.stringify(value);
    return String(value);
  }

  function editDialog(row) {
    var fields = editable();
    var tab = h("select", { id: "edit-tab" }, [h("option", { value: "field", text: "Поле договора" }), h("option", { value: "adjust", text: "Поправка начисления месяца" })]);
    var field = h("select", { id: "edit-field" }, fields.map(function (item) { return h("option", { value: item.key, text: item.title }); }));
    var value = h("input", { id: "edit-value", type: "text", placeholder: "новое значение" });
    var month = h("input", { type: "month", value: new Date().toISOString().slice(0, 7) });
    var amount = h("input", { type: "text", placeholder: "сумма вместо начисления" });
    var reason = h("input", { type: "text", placeholder: "причина - обязательна" });
    var modeBox = h("div", { hidden: true }, [
      h("label", {}, ["Изменение поля - опечатка или с даты?",
        h("select", { id: "mode-kind" }, [h("option", { value: "fix", text: "Опечатка: исправить везде" }), h("option", { value: "from_date", text: "Изменение с даты" })])]),
      h("label", {}, ["С какой даты", h("input", { id: "mode-day", type: "date" })]),
    ]);
    var out = h("div", {});
    var fieldBox = h("div", { class: "form" }, [h("label", {}, ["Поле", field]), h("label", {}, ["Значение", value]), modeBox]);
    var adjustBox = h("div", { class: "form", hidden: true }, [h("label", {}, ["Месяц", month]), h("label", {}, ["Сумма", amount]), h("label", {}, ["Причина", reason])]);
    tab.addEventListener("change", function () {
      fieldBox.hidden = tab.value !== "field";
      adjustBox.hidden = tab.value !== "adjust";
      out.innerHTML = "";
    });

    function commands() {
      if (tab.value === "adjust") {
        return [{ command: "contract.adjust", params: { id: row.id, month: month.value, amount: amount.value || null, skip: !amount.value, reason: reason.value } }];
      }
      var values = {};
      values[field.value] = value.value;
      var params = { id: row.id, values: values };
      if (!modeBox.hidden) {
        var kind = modeBox.querySelector("#mode-kind").value;
        params.mode = kind === "fix" ? { kind: "fix" } : { kind: "from_date", effective_from: modeBox.querySelector("#mode-day").value };
      }
      return [{ command: "contract.update", params: params }];
    }

    function propose() {
      out.innerHTML = "";
      out.appendChild(h("p", { class: "note", text: "Считаю, что изменится…" }));
      var batch = commands();
      call("POST", "/propose", { commands: batch }).then(function (proposal) {
        out.innerHTML = "";
        proposal.problems.forEach(function (problem) {
          if (problem.code === "mode_required") modeBox.hidden = false;
          out.appendChild(h("p", { class: "refusal", text: problem.detail }));
        });
        if (!proposal.ready) return;
        out.appendChild(h("div", { text: "Будет так:" }));
        out.appendChild(h("ul", { class: "changes" }, changeLines(proposal).map(function (line) { return h("li", { text: line }); })));
        var apply = h("button", { class: "btn plate", type: "button", text: "Применить" });
        apply.addEventListener("click", function () {
          apply.disabled = true;
          call("POST", "/apply", { commands: batch, expect: proposal.base }).then(function (done) {
            out.innerHTML = "";
            out.appendChild(h("p", { class: "done", text: "Записано: " + done.commands.map(function (item) { return item.title; }).join("; ") }));
            if (done.point) {
              var undo = h("button", { class: "btn", type: "button", text: "Отменить" });
              undo.addEventListener("click", function () {
                undo.disabled = true;
                call("POST", "/undo", { point: done.point.id }).then(function (back) {
                  out.appendChild(h("p", { class: "done", text: "Возвращено: " + (back.done.join("; ") || "-") + (back.skipped.length ? ". Не вернулось: " + back.skipped.join("; ") : "") }));
                  refresh();
                }).catch(function (error) { out.appendChild(h("p", { class: "refusal", text: error.message })); });
              });
              out.appendChild(h("div", { class: "actions" }, [undo]));
            }
            refresh();
          }).catch(function (error) {
            apply.disabled = false;
            // 409 «changed» - договор успел поменяться: предложение надо посмотреть заново.
            out.appendChild(h("p", { class: "refusal", text: error.message }));
            if (error.status === 409 && error.body && error.body.code === "changed") {
              out.appendChild(h("div", { class: "actions" }, [h("button", { class: "btn", type: "button", onclick: propose, text: "Предложить заново" })]));
            }
          });
        });
        out.appendChild(h("div", { class: "actions" }, [apply]));
      }).catch(function (error) {
        out.innerHTML = "";
        out.appendChild(h("p", { class: "refusal", text: error.message }));
      });
    }

    var body = h("div", { class: "form" }, [
      h("div", { text: [row.number || "без номера", row.client || ""].filter(Boolean).join(" · ") }),
      h("label", {}, ["Что изменить", tab]),
      fieldBox,
      adjustBox,
      h("div", { class: "actions" }, [h("button", { class: "btn", type: "button", onclick: propose, text: "Предложить" })]),
      out,
    ]);
    openDialog("Правка с последствиями", body);
  }

  // ── Карточки ────────────────────────────────────────────────────────────

  function questionOf(card) {
    var question = Object.assign({}, card.question);
    if (card.as_of) question.as_of = card.as_of;
    return question;
  }

  function ask(card) {
    card.busy = true;
    return call("POST", "/ask", questionOf(card)).then(function (answer) {
      card.answer = answer;
      card.error = "";
    }).catch(function (error) {
      card.error = error.message;
    }).then(function () {
      card.busy = false;
      draw(card);
    });
  }

  function draw(card) {
    var node = card.node || (card.node = h("section", { class: "card" }));
    node.innerHTML = "";
    var answer = card.answer;
    var title = answer ? answer.question.title : (card.question.title || "Вопрос");
    var close = h("button", { class: "x", type: "button", title: "Убрать с холста", text: "убрать" });
    close.addEventListener("click", function () {
      state.cards = state.cards.filter(function (item) { return item !== card; });
      node.remove();
      save();
    });
    node.appendChild(h("header", {}, [h("h2", { text: title }), h("span", { class: "src", text: answer ? answer.source : "" }), close]));
    var dayInput = h("input", { type: "date", value: card.as_of || (answer ? answer.as_of : "") });
    dayInput.addEventListener("change", function () {
      card.as_of = dayInput.value;
      save();
      ask(card);
    });
    node.appendChild(h("div", { class: "meta" }, [h("span", {}, ["на день ", dayInput])]));
    if (card.error) {
      node.appendChild(h("p", { class: "error", text: card.error }));
      return;
    }
    if (!answer) {
      node.appendChild(h("p", { class: "note", text: "Спрашиваю…" }));
      return;
    }
    if (answer.source === "debts") drawDebts(node, answer);
    else if (answer.source === "unbilled") drawBills(node, answer);
    else drawContracts(node, answer);
  }

  function drawContracts(node, answer) {
    var totals = answer.totals || {};
    var refs = totals.refs || {};
    var line = [h("span", { text: "договоров " + totals.contracts })];
    if (totals.amount !== undefined) line.push(h("span", {}, ["сумма ", number(totals.amount, refs.amount)]));
    if (totals.summary_remaining !== undefined) line.push(h("span", {}, ["остаток ", number(totals.summary_remaining, refs.summary_remaining)]));
    node.appendChild(h("div", { class: "total" }, line));
    var parts = (answer.parts || []).filter(function (sheet) { return sheet.blocks.some(function (block) { return block.remaining !== undefined; }); });
    if (parts.length) {
      node.appendChild(h("table", {}, [h("tbody", {}, parts.map(function (sheet) {
        return sheet.blocks.map(function (block) {
          return h("tr", {}, [
            h("td", { text: sheet.title + (block.title ? " · " + block.title : "") }),
            h("td", { class: "n", text: String(block.contracts) }),
            h("td", { class: "n" }, [block.remaining !== undefined ? number(block.remaining, block.refs && block.refs.remaining) : ""]),
          ]);
        });
      }).reduce(function (all, rows) { return all.concat(rows); }, []))]));
    }
    var hasLeft = answer.columns.some(function (column) { return column.key === "summary_remaining"; });
    var rows = answer.rows.slice().sort(function (a, b) { return Number(b.values.amount || 0) - Number(a.values.amount || 0); });
    var write = canWrite();
    node.appendChild(h("table", {}, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "Договор" }), h("th", { text: "Клиент" }), h("th", { class: "n", text: "Сумма" }), hasLeft ? h("th", { class: "n", text: "Остаток" }) : null, write ? h("th", {}) : null])]),
      h("tbody", {}, rows.slice(0, ROWS).map(function (row) {
        return h("tr", {}, [
          h("td", { text: row.number || "без номера" }),
          h("td", { text: row.client || "" }),
          h("td", { class: "n" }, [number(row.values.amount, row.refs.amount)]),
          hasLeft ? h("td", { class: "n" }, [number(row.values.summary_remaining, row.refs.summary_remaining)]) : null,
          write ? h("td", {}, [h("button", { class: "row-act", type: "button", onclick: function () { editDialog(row); }, text: "править" })]) : null,
        ]);
      })),
    ]));
    if (rows.length > ROWS) node.appendChild(h("div", { class: "more", text: "и ещё " + (rows.length - ROWS) + " - по сумме, крупные первыми" }));
  }

  function drawDebts(node, answer) {
    var totals = answer.totals;
    node.appendChild(h("div", { class: "total" }, [
      h("span", {}, ["неоплачено ", number(totals.owed, totals.refs.owed)]),
      h("span", {}, ["долг ", number(totals.debt, totals.refs.debt)]),
      h("span", { text: "договоров " + totals.contracts }),
      h("span", { text: GROUP_TITLES[answer.params.group] || "" }),
    ]));
    if (answer.error) node.appendChild(h("p", { class: "note", text: answer.error }));
    node.appendChild(h("table", {}, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "Кто" }), h("th", { class: "n", text: "Неоплачено" }), h("th", { class: "n", text: "Долг" })])]),
      h("tbody", {}, answer.rows.slice(0, ROWS).map(function (row) {
        return h("tr", {}, [h("td", { text: row.title }), h("td", { class: "n" }, [number(row.owed, row.refs.owed)]), h("td", { class: "n" }, [number(row.debt, row.refs.debt)])]);
      })),
    ]));
    if (answer.rows.length > ROWS) node.appendChild(h("div", { class: "more", text: "и ещё " + (answer.rows.length - ROWS) }));
  }

  function drawBills(node, answer) {
    var totals = answer.totals;
    node.appendChild(h("div", { class: "total" }, [h("span", { text: "счетов " + totals.bills }), totals.amount ? h("span", { text: "на " + money(totals.amount) }) : null]));
    if (!answer.board) {
      node.appendChild(h("p", { class: "note", text: "Сводная таблица не подключена - счетов к выставлению нет" }));
      return;
    }
    node.appendChild(h("table", {}, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "Клиент" }), h("th", { text: "Месяц" }), h("th", { text: "Состояние" }), h("th", { class: "n", text: "Сумма" })])]),
      h("tbody", {}, answer.rows.slice(0, ROWS).map(function (row) {
        return h("tr", {}, [h("td", { text: row.customer }), h("td", { text: row.month }), h("td", { text: row.text }), h("td", { class: "n" }, [number(row.amount, row.refs.amount)])]);
      })),
    ]));
  }

  function addCard(question, as_of) {
    var card = { question: question, as_of: as_of || "", answer: null, error: "" };
    state.cards.push(card);
    draw(card);
    board.appendChild(card.node);
    save();
    return ask(card);
  }

  function refresh() {
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      state.cards.forEach(function (card) { if (!card.busy) ask(card); });
    }, 300);
  }

  // ── Подписка ────────────────────────────────────────────────────────────

  function live(text, lost) {
    var node = document.getElementById("live");
    node.textContent = text;
    node.setAttribute("data-state", lost ? "lost" : "ok");
  }

  function follow(cursor) {
    call("GET", "/changes?wait=25&cursor=" + encodeURIComponent(cursor)).then(function (found) {
      if (state.lost) state.lost = false;
      live("живой холст · проверено " + clock(new Date()), false);
      var moved = found.moved || {};
      if (moved.schema) {
        call("GET", "/describe").then(function (described) { state.describe = described; fillAsk(); refresh(); });
      } else if (moved.contracts || moved.facts || moved.operations) {
        live("живой холст · обновлено " + clock(new Date()), false);
        refresh();
      }
      follow(found.cursor || cursor);
    }).catch(function (error) {
      if (error.status === 401) {
        live("сеанс кончился - войдите в KORT", true);
        return;
      }
      if (!state.lost) live("нет связи с " + clock(new Date()).slice(0, 5), true);
      state.lost = true;
      setTimeout(function () { follow(cursor); }, 5000);
    });
  }

  // ── Начало ──────────────────────────────────────────────────────────────

  function fillAsk() {
    var described = state.describe;
    var views = document.getElementById("add-view");
    views.innerHTML = "";
    described.views.forEach(function (view) { views.appendChild(h("option", { value: view.key, text: view.title })); });
    var sources = document.getElementById("add-source");
    sources.innerHTML = "";
    Object.keys(described.sources).forEach(function (key) {
      if (described.sources[key].open) sources.appendChild(h("option", { value: key, text: described.sources[key].title }));
    });
    var groups = document.getElementById("add-group");
    groups.innerHTML = "";
    Object.keys(GROUP_TITLES).forEach(function (key) { groups.appendChild(h("option", { value: key, text: GROUP_TITLES[key] })); });
    var departments = document.getElementById("add-department");
    departments.innerHTML = "";
    departments.appendChild(h("option", { value: "", text: "все отделы" }));
    (described.departments || []).forEach(function (item) { departments.appendChild(h("option", { value: item.id, text: item.code })); });
    var sync = function () { groups.hidden = sources.value !== "debts"; departments.hidden = sources.value === "unbilled"; };
    sources.onchange = sync;
    sync();
  }

  document.getElementById("add").addEventListener("click", function () {
    addCard({ view: document.getElementById("add-view").value });
  });

  document.getElementById("add-question").addEventListener("click", function () {
    var source = document.getElementById("add-source").value;
    var department = document.getElementById("add-department").value;
    var question = { source: source };
    var titles = [state.describe.sources[source].title];
    if (source === "debts") {
      question.params = { group: document.getElementById("add-group").value };
      titles.push(GROUP_TITLES[question.params.group]);
    }
    if (source === "contracts") question.measures = ["summary_paid", "summary_remaining"];
    if (department && source !== "unbilled") {
      question.filter = { any: [{ all: [{ field: "department", op: "eq", value: department }] }] };
      var found = (state.describe.departments || []).filter(function (item) { return item.id === department; })[0];
      titles.push(found ? found.code : "отдел");
    }
    question.title = titles.join(" · ");
    addCard(question);
  });

  call("GET", "/describe").then(function (described) {
    state.describe = described;
    document.getElementById("who").textContent = described.company.title + " · версия вызовов " + described.version;
    document.getElementById("ask").hidden = false;
    fillAsk();
    var saved = load();
    var start = saved && saved.length ? saved : described.views.filter(function (view) { return view.pinned; }).map(function (view) { return { question: { view: view.key } }; });
    start.forEach(function (item) { addCard(item.question, item.as_of); });
    live("живой холст", false);
    follow(described.cursor);
  }).catch(function (error) {
    var text = error.status === 401 ? "Войдите в KORT - холст открывается под той же учёткой." : error.message;
    board.appendChild(h("div", { class: "empty" }, [text + " ", error.status === 401 ? h("a", { href: "/", text: "Вход" }) : null]));
  });
})();
