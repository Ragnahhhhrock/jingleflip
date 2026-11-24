// Jingle Flip online leaderboard client. Talks to the Worker at /api/*.
(function () {
  var API = "/api";
  var sessionId = null;
  var NAME_KEY = "jingleflip_name";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString("en-AU"); }

  function css() {
    if (document.getElementById("lbCss")) return;
    var s = document.createElement("style");
    s.id = "lbCss";
    s.textContent =
      ".lb{margin:4px 0 6px;text-align:left}" +
      ".lb h3{margin:0 0 6px;font:800 11px Nunito,sans-serif;letter-spacing:.14em;color:var(--red);text-align:center}" +
      ".lb ol{list-style:none;margin:0;padding:0;font-weight:700;font-size:14px;color:#2B1A12}" +
      ".lb li{display:flex;gap:8px;padding:4px 8px;border-radius:8px}" +
      ".lb li:nth-child(odd){background:rgba(142,27,27,.06)}" +
      ".lb li.me{background:var(--gold);color:var(--deep)}" +
      ".lb .r{width:22px;color:var(--red)}.lb .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".lb .s{font-variant-numeric:tabular-nums}" +
      ".lb .msg{text-align:center;font-size:12px;color:#6a564a;padding:6px 0}" +
      ".lbForm{display:flex;gap:8px;margin:8px 0 4px}" +
      ".lbForm input{flex:1;min-width:0;height:44px;border-radius:999px;border:2px solid var(--pine);padding:0 14px;font:700 16px Nunito,sans-serif;color:#2B1A12;background:#fff;user-select:text;-webkit-user-select:text}" +
      ".lbForm button{height:44px;padding:0 16px;border:0;border-radius:999px;background:var(--pine);color:var(--snow);font:800 14px Nunito,sans-serif}" +
      ".lbForm button:disabled{opacity:.5}" +
      "#overlay .card{max-height:100%;overflow-y:auto;touch-action:pan-y}";
    document.head.appendChild(s);
  }

  function list(rows, meIdx) {
    if (!rows || !rows.length) return '<div class="msg">No scores yet. Be the first!</div>';
    return "<ol>" + rows.map(function (r, i) {
      return '<li class="' + (i === meIdx ? "me" : "") + '"><span class="r">' + (i + 1) +
        '</span><span class="n">' + esc(r.name) + '</span><span class="s">' + fmt(r.score) + "</span></li>";
    }).join("") + "</ol>";
  }

  function box() { return document.getElementById("lbBox"); }

  function guard(el) {
    // Stop game input handlers from eating taps and keys inside the leaderboard.
    ["pointerdown", "touchstart", "keydown", "keyup"].forEach(function (ev) {
      el.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
  }

  function fetchTop(limit) {
    return fetch(API + "/scores?limit=" + (limit || 10)).then(function (r) {
      if (!r.ok) throw new Error("bad");
      return r.json();
    });
  }

  var JFLB = {
    start: function () {
      sessionId = null;
      fetch(API + "/session", { method: "POST" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) sessionId = d.id; })
        .catch(function () {});
    },

    show: function () {
      css();
      var b = box();
      if (!b) return;
      b.innerHTML = '<div class="lb"><h3>NORTH POLE TOP 10</h3><div class="msg">Loading…</div></div>';
      fetchTop(10).then(function (d) {
        if (box() === b) b.innerHTML = '<div class="lb"><h3>NORTH POLE TOP 10</h3>' + list(d.top) + "</div>";
      }).catch(function () { b.innerHTML = ""; });
    },

    over: function (result) {
      css();
      var b = box();
      if (!b) return;
      guard(b);
      var score = result && result.score;
      var sid = sessionId;
      sessionId = null;
      b.innerHTML = '<div class="lb"><h3>NORTH POLE TOP 10</h3><div class="msg">Loading…</div></div>';

      fetchTop(10).then(function (d) {
        var top = d.top || [];
        var qualifies = score > 0 && sid && (top.length < 10 || score > top[top.length - 1].score);
        var html = '<div class="lb"><h3>NORTH POLE TOP 10</h3>' + list(top);
        if (qualifies) {
          var saved = "";
          try { saved = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
          html += '<form class="lbForm" id="lbForm"><input id="lbName" maxlength="12" placeholder="Your name" autocomplete="nickname" value="' +
            esc(saved) + '"><button id="lbSend" type="submit">Save</button></form><div class="msg" id="lbMsg">You made the board!</div>';
        }
        b.innerHTML = html + "</div>";
        var form = document.getElementById("lbForm");
        if (!form) return;
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var name = document.getElementById("lbName").value.trim();
          var msg = document.getElementById("lbMsg");
          var btn = document.getElementById("lbSend");
          if (!name) { msg.textContent = "Enter a name first"; return; }
          btn.disabled = true;
          msg.textContent = "Saving…";
          try { localStorage.setItem(NAME_KEY, name); } catch (e2) {}
          fetch(API + "/scores", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name, score: score, session: sid }),
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              if (!res.ok) { msg.textContent = res.j.error || "Could not save"; btn.disabled = false; return; }
              var me = -1;
              (res.j.top || []).forEach(function (r, i) { if (me < 0 && r.score === score && r.name === name) me = i; });
              b.innerHTML = '<div class="lb"><h3>NORTH POLE TOP 10</h3>' + list(res.j.top, me) +
                '<div class="msg">Saved! You are #' + res.j.rank + "</div></div>";
            })
            .catch(function () { msg.textContent = "Offline, could not save"; btn.disabled = false; });
        });
      }).catch(function () { b.innerHTML = ""; });
    },
  };

  window.JFLB = JFLB;
})();
