/**
 * The BenVox chat bubble.
 *
 * Dropped into someone else's page with one script tag, so the constraints are
 * unusual and worth stating:
 *
 * - NO framework, NO build step, NO dependencies. This file is served as-is and
 *   loaded by pages we do not control; pulling in a runtime would be rude and
 *   would break the moment their CSP disallows it.
 * - The chat itself lives in an IFRAME. That is the whole isolation story: their
 *   CSS cannot reach our chat, our CSS cannot reach their page, and the visitor's
 *   session token stays on our origin where their scripts cannot read it.
 * - Everything this script injects is prefixed and scoped, because a generic
 *   class name would collide with theirs eventually and the failure would look
 *   like our bug on their site.
 *
 * Usage:
 *   <script src="https://app.example.com/widget.js" data-chat="atendimento-a1b2"></script>
 *
 * Cor, posição, texto do botão e tema vêm do painel (Canais → Webchat): o
 * script pergunta ao servidor ao carregar, então mudar lá muda em todo site
 * sem recolar o código. Um data-color, data-position (right|left), data-label
 * ou data-theme (auto|light|dark) escrito à mão no código ainda ganha.
 *
 * ── O QUE MUDOU (24/09) ───────────────────────────────────────────────────
 *
 * 1. NO TELEFONE ELE OCUPA A TELA. Era um painel de 380x600 ancorado no canto:
 *    num aparelho de 360px de largura ele saía pela direita e o compositor caía
 *    debaixo da barra do navegador. Abaixo de 480px agora é tela inteira, que é
 *    o que qualquer aplicativo de conversa faz.
 * 2. ABRE E FECHA COM MOVIMENTO, e respeita quem pediu menos movimento
 *    (`prefers-reduced-motion`). Um painel que aparece de estalo parece um erro
 *    de renderização.
 * 3. FECHA POR DENTRO. O chat desenha um X no cabeçalho dele e avisa por
 *    `postMessage`; sem isto, num telefone em tela inteira, não havia saída.
 * 4. O TEMA VIAJA no endereço (`?theme=`), e o painel deixa de ser um retângulo
 *    branco à volta de um chat escuro.
 * 5. O FOCO entra no chat ao abrir e VOLTA para a bolha ao fechar — quem navega
 *    por teclado ficava preso a dar Tab na página inteira do cliente.
 */
(function () {
	"use strict";

	var script = document.currentScript;
	if (!script) return;

	var slug = script.getAttribute("data-chat") || script.getAttribute("data-slug");
	if (!slug) {
		// Loud, because a silent no-op means someone pastes the snippet, sees
		// nothing, and has no idea why.
		console.error("[benvox] widget.js needs data-chat with your chat's address");
		return;
	}

	// The origin this script was served from, so the iframe points at us rather
	// than at whatever host page it landed on.
	var origin = script.getAttribute("data-origin") || new URL(script.src, window.location.href).origin;

	// Already loaded? Two copies of the snippet on one page is a common paste
	// accident, and two bubbles stacked on each other looks broken.
	if (window.__benvoxWidget) return;
	window.__benvoxWidget = true;

	var bubble = script.getAttribute("data-bubble") !== "off";
	var visitor = {};

	/**
	 * `window.BenvoxChat` existe JÁ, antes de a aparência chegar: o que o site
	 * chamar nesse meio tempo fica na fila e roda na ordem, em vez de a página ter
	 * de tentar de novo até o widget aparecer.
	 */
	var queue = [];
	var api = {};
	["open", "close", "mount", "identify"].forEach(function (name) {
		api[name] = function () {
			queue.push([name, [].slice.call(arguments)]);
		};
	});
	window.BenvoxChat = {
		open: function () {
			return api.open.apply(null, arguments);
		},
		close: function () {
			return api.close.apply(null, arguments);
		},
		mount: function () {
			return api.mount.apply(null, arguments);
		},
		identify: function () {
			return api.identify.apply(null, arguments);
		},
	};

	// A aparência salva no painel. Falhou a rede? A bolha sai assim mesmo, com o
	// que o código colado disser e o resto padrão — um chat que não aparece é pior.
	fetch(origin + "/v3/public/chat/" + encodeURIComponent(slug))
		.then(function (res) {
			return res.ok ? res.json() : {};
		})
		.catch(function () {
			return {};
		})
		.then(boot);

	function boot(saved) {
		var color = script.getAttribute("data-color") || saved.color || "#10b981";
		var side = (script.getAttribute("data-position") || saved.position) === "left" ? "left" : "right";
		var label = script.getAttribute("data-label") || saved.label || "Fale conosco";
		var theme = script.getAttribute("data-theme") || saved.theme;

		// A colour from an attribute reaches inline styles, so anything that is not a
		// hex value is dropped rather than passed through.
		if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) color = "#10b981";
		// O mesmo cuidado para o tema: só duas palavras chegam ao endereço.
		if (theme !== "light" && theme !== "dark") theme = null;

		var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		var phone = function () {
			return window.matchMedia && window.matchMedia("(max-width: 480px)").matches;
		};

		var root = document.createElement("div");
		root.id = "benvox-widget-root";
		root.style.cssText =
			"position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;font-family:inherit;";

		var panel = document.createElement("div");
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", label);

		/**
		 * O painel mede-se a cada abertura, porque a tela pode ter rodado.
		 *
		 * No telefone ele é `position:fixed` e cola nos quatro cantos; no computador
		 * continua ancorado por cima da bolha. Os dois casos escrevem o mesmo elemento
		 * — dois elementos seriam duas conversas, e trocar de um para o outro ao rodar
		 * o aparelho recarregaria o iframe no meio de uma frase.
		 */
		function placePanel() {
			var shared =
				"box-sizing:border-box;background:transparent;overflow:hidden;" +
				"box-shadow:0 12px 48px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.06);" +
				"transform-origin:bottom " +
				side +
				";" +
				(calm ? "" : "transition:opacity .18s ease, transform .18s ease;");
			// `cssText` apaga o que estava escrito à mão, opacidade inclusive — por
			// isso quem manda no estado (aberto/fechado) é `show`/`hide`, e esta função
			// só sabe de TAMANHO.
			panel.style.cssText = phone()
				? "position:fixed;inset:0;width:100%;height:100%;border-radius:0;border:0;" + shared
				: "position:absolute;bottom:72px;" +
					side +
					":0;width:min(400px,calc(100vw - 40px));height:min(640px,calc(100vh - 120px));" +
					"border-radius:16px;" +
					shared;
			paint();
		}

		/** O estado visível, depois de qualquer medição. */
		function paint() {
			panel.style.display = open ? "block" : "none";
			panel.style.opacity = open ? "1" : "0";
			panel.style.transform = open ? "scale(1)" : "scale(.96)";
		}

		/**
		 * UM IFRAME POR CHAT, todos no mesmo painel.
		 *
		 * Um site com vários atendimentos (um robô por página, uma filial por aba)
		 * abre cada um no seu canal — com agente e funil próprios — e trocar de um
		 * para o outro não perde a conversa do primeiro. Só o atual aparece.
		 */
		var bubbleFrames = {};
		var current = slug;

		function bubbleFrame(chat) {
			if (bubbleFrames[chat]) return bubbleFrames[chat];
			var el = document.createElement("iframe");
			el.title = label;
			el.style.cssText = "width:100%;height:100%;border:0;display:none;";
			el.allow = "microphone";
			// Carregado ao ABRIR, nunca ao carregar a página: um iframe que todo
			// visitante baixa e quase ninguém abre é custo na nota de velocidade alheia.
			el.src = chatUrl(chat, "widget");
			panel.appendChild(el);
			bubbleFrames[chat] = track(el, "widget");
			return bubbleFrames[chat];
		}

		var button = document.createElement("button");
		button.type = "button";
		button.setAttribute("aria-label", label);
		button.setAttribute("aria-expanded", "false");
		button.style.cssText =
			"width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;" +
			"background:" +
			color +
			";color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.22);" +
			"display:flex;align-items:center;justify-content:center;padding:0;" +
			(calm ? "" : "transition:transform .15s ease;");
		button.innerHTML = bubbleIcon();
		button.addEventListener("mouseenter", function () {
			if (!calm) button.style.transform = "scale(1.06)";
		});
		button.addEventListener("mouseleave", function () {
			button.style.transform = "scale(1)";
		});

		var open = false;

		/**
		 * O endereço da conversa. `widget=1` diz à página de dentro que ela está
		 * numa BOLHA (desenha o X de fechar); `embed=1`, que está no meio do site.
		 * Quem é o visitante, quando o site disse (`identify`), vai junto: a página
		 * pula o formulário e guarda a conversa DESSA pessoa.
		 */
		function chatUrl(chat, mode) {
			var q = [mode + "=1"];
			if (theme) q.push("theme=" + theme);
			["name", "email", "phone"].forEach(function (k) {
				if (visitor[k]) q.push(k + "=" + encodeURIComponent(visitor[k]));
			});
			return origin + "/c/" + encodeURIComponent(chat) + "?" + q.join("&");
		}

		function show(chat) {
			open = true;
			current = chat || current;
			var entry = bubbleFrame(current);
			for (var key in bubbleFrames) {
				bubbleFrames[key].el.style.display = key === current ? "block" : "none";
			}
			placePanel();
			// Parte de onde a animação começa — e só depois vai para o fim. Sem isto o
			// painel já nascia opaco e a transição não tinha de onde correr.
			panel.style.display = "block";
			panel.style.opacity = calm ? "1" : "0";
			panel.style.transform = calm ? "scale(1)" : "scale(.96)";
			// Dois quadros antes de animar: um elemento que acabou de sair do
			// `display:none` não tem estado de onde transitar.
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					panel.style.opacity = "1";
					panel.style.transform = "scale(1)";
				});
			});
			// No telefone, a bolha sai da frente: em tela inteira ela ficaria por cima
			// do compositor.
			button.style.display = phone() ? "none" : "flex";
			button.innerHTML = closeIcon();
			button.setAttribute("aria-expanded", "true");
			// O foco entra na conversa; sem isto, o Tab seguinte voltava para a página
			// do cliente e a pessoa nunca alcançava o campo de escrever.
			try {
				entry.el.focus();
			} catch (error) {
				/* um iframe de outra origem pode recusar: não é motivo para nada falhar */
			}
			return entry;
		}

		function hide() {
			open = false;
			panel.style.opacity = "0";
			panel.style.transform = "scale(.96)";
			button.style.display = "flex";
			button.innerHTML = bubbleIcon();
			button.setAttribute("aria-expanded", "false");
			if (bubble) button.focus();
			if (calm) {
				panel.style.display = "none";
				return;
			}
			window.setTimeout(function () {
				if (!open) panel.style.display = "none";
			}, 180);
		}

		function toggle() {
			if (open) hide();
			else show();
		}

		button.addEventListener("click", toggle);

		// Escape closes it. Without this the only way out on a phone is to find a
		// 24-pixel target in the corner.
		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape" && open) hide();
		});

		/**
		 * Cada conversa aberta — na bolha ou montada na página — e o que o site
		 * pediu para ela dizer antes de estar pronta.
		 */
		var tracked = [];
		function track(el, mode) {
			var entry = { el: el, mode: mode, ready: false, pending: null };
			tracked.push(entry);
			return entry;
		}

		/**
		 * O X DENTRO DO CHAT, e o "estou pronta".
		 *
		 * Só se aceita a mensagem de um iframe NOSSO (`event.source`): qualquer
		 * página pode mandar um `postMessage`, e sem essa conferência um anúncio
		 * noutro iframe fecharia a conversa de alguém.
		 */
		window.addEventListener("message", function (event) {
			var entry = null;
			for (var i = 0; i < tracked.length; i++) {
				if (tracked[i].el.contentWindow === event.source) entry = tracked[i];
			}
			if (!entry) return;
			var data = event.data;
			if (data && data.type === "benvox:chat:close" && entry.mode === "widget" && open) hide();
			if (data && data.type === "benvox:chat:ready") {
				entry.ready = true;
				flush(entry);
			}
		});

		/**
		 * O SITE FALA PELO VISITANTE (dono, 28/10): o texto sai como mensagem dele —
		 * a escolha feita na página chega à atendente sem copiar e colar. Espera a
		 * conversa dizer que está pronta.
		 */
		function say(entry, text) {
			if (typeof text === "string" && text.trim()) entry.pending = text.trim();
			flush(entry);
		}
		function flush(entry) {
			if (!entry.ready || !entry.pending || !entry.el.contentWindow) return;
			// "*" e não `origin`: no site publicado (CSP sandbox) o iframe herda origem
			// OPACA, e endereçar a `origin` faria o navegador descartar a mensagem calado.
			// O destino já é o nosso iframe (`contentWindow`), não uma janela qualquer.
			entry.el.contentWindow.postMessage({ type: "benvox:chat:say", text: entry.pending }, "*");
			entry.pending = null;
		}

		api.open = function (arg) {
			// `open("texto")` é a forma de antes: o chat do código colado.
			var o = typeof arg === "string" || arg == null ? { text: arg } : arg;
			if (o.visitor) api.identify(o.visitor);
			var chat = o.chat || current;
			var entry = open && chat === current ? bubbleFrame(chat) : show(chat);
			say(entry, o.text);
		};

		api.close = function () {
			if (open) hide();
		};

		/**
		 * A CONVERSA DENTRO DA PÁGINA: `mount(elemento ou seletor, {chat, text})`.
		 * Ocupa o elemento inteiro; quem decide o tamanho é o layout do site.
		 */
		api.mount = function (target, o) {
			o = o || {};
			var host = typeof target === "string" ? document.querySelector(target) : target;
			if (!host) {
				console.error("[benvox] BenvoxChat.mount: element not found", target);
				return null;
			}
			if (o.visitor) api.identify(o.visitor);
			var el = document.createElement("iframe");
			el.title = label;
			el.allow = "microphone";
			el.style.cssText = "width:100%;height:100%;min-height:420px;border:0;display:block;";
			el.src = chatUrl(o.chat || slug, "embed");
			host.innerHTML = "";
			host.appendChild(el);
			var entry = track(el, "embed");
			entry.chat = o.chat || slug;
			say(entry, o.text);
			return {
				say: function (text) {
					say(entry, text);
				},
				remove: function () {
					el.remove();
					tracked = tracked.filter(function (x) {
						return x !== entry;
					});
				},
			};
		};

		/**
		 * QUEM É O VISITANTE, dito pelo site depois do login dele. Vale para as
		 * conversas abertas daqui em diante; as da bolha recomeçam, para a pessoa
		 * nova não cair na conversa de quem estava antes.
		 */
		api.identify = function (v) {
			v = v || {};
			var next = {
				name: typeof v.name === "string" ? v.name.trim() : "",
				email: typeof v.email === "string" ? v.email.trim() : "",
				phone: typeof v.phone === "string" ? v.phone.trim() : "",
			};
			// A mesma pessoa de novo (cada `open` pode trazer o visitante) não recomeça nada.
			if (JSON.stringify(next) === JSON.stringify(visitor)) return;
			visitor = next;
			for (var key in bubbleFrames) {
				var stale = bubbleFrames[key];
				stale.el.remove();
				tracked = tracked.filter(function (x) {
					return x !== stale;
				});
			}
			bubbleFrames = {};
			if (open) show(current);
			// As montadas na página ficam no lugar e recarregam já com a pessoa.
			tracked.forEach(function (entry) {
				if (entry.mode !== "embed") return;
				entry.ready = false;
				// Texto ainda não enviado pertence à pessoa anterior.
				entry.pending = null;
				entry.el.src = chatUrl(entry.chat, "embed");
			});
		};

		// Rodar o aparelho troca o telefone pelo computador e vice-versa; o painel
		// remede-se, e o iframe continua onde estava.
		window.addEventListener("resize", function () {
			if (open) {
				placePanel();
				button.style.display = phone() ? "none" : "flex";
			}
		});

		placePanel();
		root.appendChild(panel);
		// `data-bubble="off"`: o site só usa `mount`/`open`, sem bolha no canto.
		if (bubble) root.appendChild(button);

		// `document.body` may not exist yet if the snippet sits in <head>.
		if (document.body) document.body.appendChild(root);
		else
			document.addEventListener("DOMContentLoaded", function () {
				document.body.appendChild(root);
			});

		// O que o site pediu antes de a aparência chegar, na ordem em que pediu.
		queue.forEach(function (call) {
			api[call[0]].apply(null, call[1]);
		});
		queue = [];

	}

	function bubbleIcon() {
		return (
			'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
			'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
			'<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
		);
	}

	function closeIcon() {
		return (
			'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
			'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
			'<path d="M18 6 6 18M6 6l12 12"/></svg>'
		);
	}
})();
