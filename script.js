/* =========================================================
   DÍA DE LAS INFANCIAS — ¿Hace cuánto que trabaja acá?
   ---------------------------------------------------------
   Este archivo tiene 4 partes:
   1) FIREBASE: login con Google + base de datos del ranking
   2) LOS DATOS de los compañeros (por ahora, 3 de prueba)
   3) LA LÓGICA del juego (rondas, puntaje, antigüedad, timer)
   4) EL RANKING (guardado en Firestore, compartido entre todos)
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ---------------------------------------------------------
// 1) FIREBASE: configuración e inicialización
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDegUXQOrngA2XELxIclhrQewtbztj8bpI",
  authDomain: "children-s-day-2026.firebaseapp.com",
  projectId: "children-s-day-2026",
  storageBucket: "children-s-day-2026.firebasestorage.app",
  messagingSenderId: "771908387962",
  appId: "1:771908387962:web:5691a8e988824714ef27c3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Dominio corporativo permitido para jugar
const DOMINIO_PERMITIDO = "muttdata.ai";

// MODO PRUEBA: agregando ?modo=test al final del link (por ejemplo
// .../dia-infancias-juego/?modo=test) se puede jugar todas las veces
// que se quiera, sin bloqueos y sin tocar el ranking oficial de la empresa.
const MODO_PRUEBA = new URLSearchParams(window.location.search).get("modo") === "test";
const NOMBRE_COLECCION = MODO_PRUEBA ? "puntajes_test" : "puntajes";

let usuarioActual = null;      // datos del usuario logueado
let yaJugoAntes = false;       // si ya tiene un puntaje guardado en el ranking oficial

// ---------------------------------------------------------
// 2) DATOS DE PRUEBA
// Cuando tengamos el roster completo, esta función se va a
// reemplazar por una que lea directo del Google Sheet publicado
// como CSV. La estructura de cada persona queda igual.
// ---------------------------------------------------------
function obtenerPerfiles() {
  return [
    {
      id: "emp01",
      nombre: "Francisco Murias",
      puesto: "People Partner & Culture",
      equipo: "People",
      fotoOriginal: "https://ca.slack-edge.com/T59ULFZ3N-U03NBGA91GA-633c17f0b6b0-512",
      fotoNino: "fotos/cisco_nino.png",
      fechaIngreso: "2022-07-05"
    },
    {
      id: "emp02",
      nombre: "Ana Rottjer",
      puesto: "Head of People",
      equipo: "People",
      fotoOriginal: "https://ca.slack-edge.com/T59ULFZ3N-U06NFTXR7L7-8f1934bd11f7-512",
      fotoNino: "fotos/nuni_nino.png",
      fechaIngreso: "2024-03-11"
    },
    {
      id: "emp03",
      nombre: "Cintia Mancinelli",
      puesto: "Procurement & Facilities",
      equipo: "People",
      fotoOriginal: "https://ca.slack-edge.com/T59ULFZ3N-U029FHR832B-c4721b93cad5-512",
      fotoNino: "fotos/tana_nino.png",
      fechaIngreso: "2021-08-02"
    }
  ];
}

// ---------------------------------------------------------
// 3) LÓGICA DEL JUEGO
// ---------------------------------------------------------
const CANTIDAD_RONDAS_DESEADA = 10; // en el juego real, se muestran 10 perfiles al azar
const SEGUNDOS_POR_RONDA = 10;

let perfilesJuego = [];
let rondaActual = 0;
let puntajeTotal = 0;
let resultadosRonda = []; // {diferenciaMeses, puntos} de cada ronda jugada
let intervaloTimer = null;

function calcularAntiguedad(fechaIngresoISO) {
  const ingreso = new Date(fechaIngresoISO + "T00:00:00");
  const hoy = new Date();
  let anios = hoy.getFullYear() - ingreso.getFullYear();
  let meses = hoy.getMonth() - ingreso.getMonth();
  if (hoy.getDate() < ingreso.getDate()) meses -= 1;
  if (meses < 0) { anios -= 1; meses += 12; }
  return { anios, meses };
}

function calcularDiferenciaMeses(anioRespuesta, mesRespuesta, anioReal, mesReal) {
  const totalRespuesta = anioRespuesta * 12 + mesRespuesta;
  const totalReal = anioReal * 12 + mesReal;
  return Math.abs(totalRespuesta - totalReal);
}

function calcularPuntos(diferenciaMeses) {
  if (diferenciaMeses === 0) return 100;
  if (diferenciaMeses <= 3) return 75;
  if (diferenciaMeses <= 6) return 50;
  if (diferenciaMeses <= 12) return 20;
  return 0;
}

function formatearMeses(meses) {
  return meses === 1 ? "1 mes" : `${meses} meses`;
}

function formatearNumero(numero) {
  return numero.toLocaleString("es-AR");
}

function elegirPerfilesAlAzar(perfiles, cantidad) {
  const copia = [...perfiles];
  const elegidos = [];
  const total = Math.min(cantidad, copia.length);
  for (let i = 0; i < total; i++) {
    const indiceAlAzar = Math.floor(Math.random() * copia.length);
    elegidos.push(copia.splice(indiceAlAzar, 1)[0]);
  }
  return elegidos;
}

function formatearAntiguedad(anios, meses) {
  const partesAnios = anios === 1 ? "1 año" : `${anios} años`;
  const partesMeses = meses === 1 ? "1 mes" : `${meses} meses`;
  if (anios === 0) return partesMeses;
  if (meses === 0) return partesAnios;
  return `${partesAnios} y ${partesMeses}`;
}

// Comentario divertido según qué tan cerca estuvo la respuesta
function obtenerComentario(puntos) {
  if (puntos === 100) return "🏆 ¡Exacto! ¿Tenés una base de datos de Mutters en la cabeza?";
  if (puntos === 75) return "🔥 ¡Casi perfecto! La tenías bastante clara.";
  if (puntos === 50) return "😎 Bastante cerca. Conocés a este Mutter.";
  if (puntos === 20) return "🙂 Cerca… pero necesitás más atención en #kudos";
  return "💀 Hay que hacer más matecitos con los Mutters.";
}

// Categoría final según el puntaje total (pensada para una partida de 10 rondas / 1000 puntos)
function obtenerCategoria(puntaje) {
  if (puntaje >= 1000) return { emoji: "🏆", nombre: "Mutter legendario", mensaje: "🏆 ¡MUTTER LEGENDARIO! ¡No se te escapa una!" };
  if (puntaje >= 900) return { emoji: "👑", nombre: "Mutter histórico", mensaje: "👑 ¡Mutter histórico! Casi nadie conoce tanto a sus compañeros." };
  if (puntaje >= 700) return { emoji: "🧠", nombre: "Mutter enciclopedia", mensaje: "🧠 ¡Mutter enciclopedia! ¿Miraste BambooHR?" };
  if (puntaje >= 500) return { emoji: "🎒", nombre: "Mutter experto", mensaje: "🎒 ¡Bastante bien! Conocés a los Mutters más de lo que pensabas." };
  if (puntaje >= 250) return { emoji: "🖍️", nombre: "Mutter en crecimiento", mensaje: "🖍️ Vas creciendo… pero todavía te quedan algunos Mutters por conocer." };
  return { emoji: "🧸", nombre: "Baby Mutter", mensaje: "🧸 Recién estás conociendo a los Mutters. ¡Hay mucho por descubrir!" };
}

function iniciarTimer() {
  detenerTimer();
  let segundosRestantes = SEGUNDOS_POR_RONDA;
  actualizarTimerUI(segundosRestantes);
  intervaloTimer = setInterval(() => {
    segundosRestantes--;
    actualizarTimerUI(segundosRestantes);
    if (segundosRestantes <= 0) {
      detenerTimer();
      confirmarRespuesta();
    }
  }, 1000);
}

function detenerTimer() {
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
    intervaloTimer = null;
  }
}

function actualizarTimerUI(segundos) {
  const elSegundos = document.getElementById("timer-segundos");
  const elContenedor = document.getElementById("timer");
  elSegundos.textContent = segundos;
  elContenedor.classList.toggle("timer-urgente", segundos <= 3);
}

const screens = {
  login: document.getElementById("screen-login"),
  yaJugaste: document.getElementById("screen-ya-jugaste"),
  inicio: document.getElementById("screen-inicio"),
  ronda: document.getElementById("screen-ronda"),
  revelacion: document.getElementById("screen-revelacion"),
  final: document.getElementById("screen-final"),
  ranking: document.getElementById("screen-ranking"),
};

function mostrarPantalla(nombre) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[nombre].classList.add("active");
}

function llenarSelectores() {
  const selectAnios = document.getElementById("select-anios");
  const selectMeses = document.getElementById("select-meses");
  selectAnios.innerHTML = "";
  selectMeses.innerHTML = "";
  for (let a = 0; a <= 8; a++) {
    const opt = document.createElement("option");
    opt.value = a; opt.textContent = a;
    selectAnios.appendChild(opt);
  }
  for (let m = 0; m <= 11; m++) {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    selectMeses.appendChild(opt);
  }
}

function empezarJuego() {
  perfilesJuego = elegirPerfilesAlAzar(obtenerPerfiles(), CANTIDAD_RONDAS_DESEADA);
  rondaActual = 0;
  puntajeTotal = 0;
  resultadosRonda = [];
  document.getElementById("ronda-total").textContent = perfilesJuego.length;
  mostrarRonda();
}

function mostrarRonda() {
  const perfil = perfilesJuego[rondaActual];
  document.getElementById("ronda-actual").textContent = rondaActual + 1;
  document.getElementById("foto-real").src = perfil.fotoOriginal;
  document.getElementById("ronda-nombre").textContent = perfil.nombre;
  document.getElementById("ronda-puesto").textContent = `${perfil.puesto} · ${perfil.equipo}`;
  llenarSelectores();
  mostrarPantalla("ronda");
  iniciarTimer();
}

function confirmarRespuesta() {
  detenerTimer();
  const perfil = perfilesJuego[rondaActual];
  const anioRespuesta = parseInt(document.getElementById("select-anios").value, 10);
  const mesRespuesta = parseInt(document.getElementById("select-meses").value, 10);

  const antiguedadReal = calcularAntiguedad(perfil.fechaIngreso);
  const diferenciaMeses = calcularDiferenciaMeses(anioRespuesta, mesRespuesta, antiguedadReal.anios, antiguedadReal.meses);
  const puntos = calcularPuntos(diferenciaMeses);
  puntajeTotal += puntos;
  resultadosRonda.push({ diferenciaMeses, puntos });

  document.getElementById("revelacion-titulo").textContent = "👶 SI SU ANTIGÜEDAD FUESE SU EDAD…";
  document.getElementById("foto-nino-rev").src = perfil.fotoNino;
  document.getElementById("rev-nombre").textContent = perfil.nombre;
  document.getElementById("rev-edad-equivalente").textContent = formatearAntiguedad(antiguedadReal.anios, antiguedadReal.meses);
  document.getElementById("rev-antiguedad-real").textContent = formatearAntiguedad(antiguedadReal.anios, antiguedadReal.meses);
  document.getElementById("rev-tu-respuesta").textContent = formatearAntiguedad(anioRespuesta, mesRespuesta);
  document.getElementById("rev-diferencia").textContent = formatearMeses(diferenciaMeses);
  document.getElementById("rev-puntos").textContent = puntos;
  document.getElementById("rev-comentario").textContent = obtenerComentario(puntos);

  const esUltimaRonda = rondaActual === perfilesJuego.length - 1;
  document.getElementById("btn-siguiente").textContent = esUltimaRonda ? "🏆 Ver resultado final" : "➡️ Siguiente Mutter";

  mostrarPantalla("revelacion");
}

async function siguienteRonda() {
  rondaActual++;
  if (rondaActual < perfilesJuego.length) {
    mostrarRonda();
  } else {
    await mostrarPantallaFinal();
  }
}

async function mostrarPantallaFinal() {
  const puntajeMaximo = perfilesJuego.length * 100;
  const categoria = obtenerCategoria(puntajeTotal);
  const respuestasExactas = resultadosRonda.filter(r => r.puntos === 100).length;
  const mesesDiferenciaAcumulada = resultadosRonda.reduce((suma, r) => suma + r.diferenciaMeses, 0);

  document.getElementById("puntaje-total").textContent = formatearNumero(puntajeTotal);
  document.getElementById("puntaje-maximo").textContent = formatearNumero(puntajeMaximo);
  document.getElementById("final-categoria").textContent = `${categoria.emoji} ${categoria.nombre}`;
  document.getElementById("final-mensaje-categoria").textContent = categoria.mensaje;
  document.getElementById("resumen-cantidad").textContent = perfilesJuego.length;
  document.getElementById("resumen-exactas").textContent = respuestasExactas;
  document.getElementById("resumen-meses-diff").textContent = mesesDiferenciaAcumulada;

  await finalizarPartida();
  mostrarPantalla("final");
}

// ---------------------------------------------------------
// 4) RANKING EN FIRESTORE
// Regla clave (configurada en Firestore, no solo en este código):
// un documento en "puntajes/{uid}" solo se puede CREAR una vez,
// nunca actualizar. Así el primer puntaje de cada persona queda
// fijo para siempre, sin importar cuántas veces vuelva a jugar.
// ---------------------------------------------------------
async function finalizarPartida() {
  const notaFinal = document.getElementById("final-nota");

  if (MODO_PRUEBA) {
    // En modo prueba, cada partida se guarda como un registro nuevo
    // en una colección aparte, y nunca bloquea ni cuenta como "ya jugaste".
    try {
      await setDoc(doc(collection(db, NOMBRE_COLECCION)), {
        nombre: usuarioActual.displayName || usuarioActual.email,
        email: usuarioActual.email,
        puntos: puntajeTotal,
        fecha: new Date().toISOString()
      });
      notaFinal.textContent = "🧪 Modo prueba: este puntaje NO afecta el ranking oficial. Podés jugar de nuevo las veces que quieras.";
    } catch (error) {
      console.error("Error guardando el puntaje de prueba:", error);
      notaFinal.textContent = "🧪 Modo prueba: no se pudo guardar en la colección de prueba, pero el juego funcionó bien.";
    }
    return;
  }

  if (yaJugoAntes) {
    notaFinal.textContent = "Este puntaje fue solo por diversión: tu puntaje oficial en el ranking sigue siendo el de tu primera partida.";
    return;
  }
  try {
    await setDoc(doc(db, NOMBRE_COLECCION, usuarioActual.uid), {
      nombre: usuarioActual.displayName || usuarioActual.email,
      email: usuarioActual.email,
      puntos: puntajeTotal,
      fecha: new Date().toISOString()
    });
    yaJugoAntes = true;
    notaFinal.textContent = "¡Tu puntaje quedó guardado en el ranking oficial!";
  } catch (error) {
    console.error("Error guardando el puntaje:", error);
    notaFinal.textContent = "Hubo un problema guardando tu puntaje en el ranking. Contactá a RRHH.";
  }
}

async function mostrarRanking() {
  const lista = document.getElementById("lista-ranking");
  lista.innerHTML = "<li>Cargando ranking...</li>";
  try {
    const q = query(collection(db, NOMBRE_COLECCION), orderBy("puntos", "desc"), limit(15));
    const snapshot = await getDocs(q);
    lista.innerHTML = "";
    if (snapshot.empty) {
      lista.innerHTML = "<li>Todavía no hay puntajes guardados.</li>";
      return;
    }
    let indice = 0;
    snapshot.forEach(docSnap => {
      const entrada = docSnap.data();
      const li = document.createElement("li");
      const medalla = indice === 0 ? "🥇 " : indice === 1 ? "🥈 " : indice === 2 ? "🥉 " : `${indice + 1}. `;
      li.innerHTML = `<span>${medalla}${entrada.nombre}</span><span>${entrada.puntos} pts</span>`;
      lista.appendChild(li);
      indice++;
    });
  } catch (error) {
    console.error("Error leyendo el ranking:", error);
    lista.innerHTML = "<li>No se pudo cargar el ranking. Probá de nuevo en un momento.</li>";
  }
}

// ---------------------------------------------------------
// LOGIN CON GOOGLE
// ---------------------------------------------------------
async function iniciarSesion() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: DOMINIO_PERMITIDO }); // sugiere el dominio en el selector de cuentas
  const elError = document.getElementById("login-error");
  elError.textContent = "";

  try {
    const resultado = await signInWithPopup(auth, provider);
    await procesarUsuarioLogueado(resultado.user);
  } catch (error) {
    console.error("Error de login:", error);
    elError.textContent = "No se pudo iniciar sesión. Probá de nuevo.";
  }
}

async function procesarUsuarioLogueado(user) {
  const elError = document.getElementById("login-error");

  // Verificación real del dominio (la restricción de Firestore es la que
  // de verdad protege los datos; esto es solo para dar feedback rápido).
  if (!user.email || !user.email.endsWith("@" + DOMINIO_PERMITIDO)) {
    elError.textContent = `Este juego es solo para cuentas @${DOMINIO_PERMITIDO}. Iniciá sesión con tu cuenta de la empresa.`;
    await signOut(auth);
    return;
  }

  usuarioActual = user;

  if (MODO_PRUEBA) {
    // En modo prueba nunca bloqueamos: siempre se puede jugar de nuevo.
    yaJugoAntes = false;
    mostrarPantalla("inicio");
    return;
  }

  // ¿Ya jugó antes? Buscamos su documento en la colección "puntajes".
  const refDoc = doc(db, NOMBRE_COLECCION, user.uid);
  const snapshot = await getDoc(refDoc);

  if (snapshot.exists()) {
    yaJugoAntes = true;
    document.getElementById("ya-jugaste-puntos").textContent = snapshot.data().puntos;
    mostrarPantalla("yaJugaste");
  } else {
    yaJugoAntes = false;
    mostrarPantalla("inicio");
  }
}

// Si la persona ya tenía una sesión abierta (visita repetida), la reconocemos
// automáticamente sin pedirle que toque el botón de login de nuevo.
onAuthStateChanged(auth, (user) => {
  if (user && !usuarioActual) {
    procesarUsuarioLogueado(user);
  }
});

// ---------------------------------------------------------
// Conexión de botones
// ---------------------------------------------------------
document.getElementById("btn-login").addEventListener("click", iniciarSesion);
document.getElementById("btn-empezar").addEventListener("click", empezarJuego);
document.getElementById("btn-confirmar").addEventListener("click", confirmarRespuesta);
document.getElementById("btn-siguiente").addEventListener("click", siguienteRonda);

document.getElementById("btn-guardar").addEventListener("click", () => {
  mostrarRanking();
  mostrarPantalla("ranking");
});

document.getElementById("btn-jugar-de-nuevo-fun").addEventListener("click", () => {
  mostrarPantalla("inicio");
});

document.getElementById("btn-ver-ranking-yj").addEventListener("click", () => {
  mostrarRanking();
  mostrarPantalla("ranking");
});

document.getElementById("btn-jugar-de-nuevo").addEventListener("click", () => {
  mostrarPantalla(yaJugoAntes ? "yaJugaste" : "inicio");
});

document.getElementById("btn-jugar-de-nuevo-final").addEventListener("click", () => {
  mostrarPantalla(yaJugoAntes ? "yaJugaste" : "inicio");
});
