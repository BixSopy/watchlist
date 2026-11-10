#!/usr/bin/env python3
"""Kit de sons « maison » de Cinepisode (synthèse modale rendue hors ligne) : génère sounds/done.mp3,
sounds/err.mp3 et sounds/del.mp3. Hors build (le site ne l'exécute jamais) ; à relancer seulement pour
retoucher ces sons. Dépendances : python3, numpy, scipy, ffmpeg (libmp3lame).

  python3 scripts/sounds-maison.py            # réécrit les 3 sons utilisés dans sounds/
  python3 scripts/sounds-maison.py --all DIR  # les 10 sons du kit (banc d'écoute) dans DIR

Principe : chaque son est une somme de modes amortis (sinusoïdes qui s'éteignent chacune à son rythme,
avec les rapports de fréquences d'une lame de bois ou d'une cloche) + un très court bruit de contact.
Aucune mélodie, aucune onde électronique nue. La graine aléatoire et l'ordre de génération sont fixes :
même sortie à chaque exécution.
"""
import os, subprocess, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Niveau cible par rôle (dBFS, RMS court max), identique au banc d'écoute
TARGET = {'click': -27, 'hover': -36, 'next': -24, 'open': -25, 'close': -26, 'add': -22,
          'done': -22, 'del': -23, 'err': -23, 'toast': -25}
USED = ['done', 'err', 'del']
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def modes(f0, ratios, amps, taus, dur, glide=1.0):
    t = t_axis(dur)
    mult = glide ** (t / dur) if glide != 1.0 else np.ones_like(t)
    out = np.zeros_like(t)
    for r, a, tau in zip(ratios, amps, taus):
        ph = 2 * np.pi * np.cumsum(f0 * r * mult) / SR
        out += a * np.exp(-t / tau) * np.sin(ph)
    return out


def transient(dur, lo, hi, tau, amp):
    t = t_axis(dur)
    n = rng.standard_normal(len(t)) * np.exp(-t / tau)
    return amp * signal.sosfilt(signal.butter(2, [lo, hi], 'bandpass', fs=SR, output='sos'), n)


def air(dur, amp, lp=2600, tau=0.02):
    sos = signal.butter(2, lp, 'lowpass', fs=SR, output='sos')
    return amp * signal.sosfilt(sos, rng.standard_normal(int(dur * SR)) * np.exp(-t_axis(dur) / tau))


def finish(x, attack=0.0015, lp=7000):
    n = int(attack * SR)
    if n:
        x[:n] *= np.sin(np.linspace(0, np.pi / 2, n)) ** 2
    y = signal.sosfilt(signal.butter(2, lp, 'lowpass', fs=SR, output='sos'), x)
    m = int(0.012 * SR)
    y[-m:] *= np.cos(np.linspace(0, np.pi / 2, m)) ** 2
    return y


def place(total, parts):
    out = np.zeros(int(total * SR))
    for off, x in parts:
        i = int(off * SR)
        j = min(len(out), i + len(x))
        out[i:j] += x[:j - i]
    return out


def mk_click():
    d = 0.045
    return finish(transient(d, 2000, 5200, 0.0012, 0.6) + modes(1850, [1, 1.72], [0.45, 0.2], [0.007, 0.004], d))


def mk_hover():
    return finish(transient(0.014, 3200, 8000, 0.0006, 0.5), lp=9000)


def mk_next():
    d = 0.1
    return finish(transient(d, 1500, 5000, 0.001, 0.35)
                  + modes(1150, [1, 2.756, 5.404], [1, 0.3, 0.08], [0.03, 0.012, 0.005], d, glide=1.04))


def mk_open():
    d = 0.12
    return finish(modes(430, [1, 2.01], [1, 0.12], [0.035, 0.015], d, glide=1.65) + air(d, 0.05), attack=0.004, lp=5000)


def mk_close():
    d = 0.11
    return finish(modes(700, [1, 2.01], [1, 0.1], [0.03, 0.012], d, glide=0.6) + air(d, 0.04), attack=0.003, lp=4500)


def mk_add():
    d = 0.22
    return finish(transient(d, 1500, 6000, 0.0015, 0.45)
                  + modes(700, [1, 2.756, 5.404], [1, 0.38, 0.11], [0.06, 0.024, 0.009], d))


def mk_done():
    # deux frappes de marimba (rapports 1 : 3,93), à la quinte, la seconde plus longue
    a = modes(660, [1, 3.93], [0.8, 0.12], [0.05, 0.012], 0.12) + transient(0.12, 1500, 5000, 0.0012, 0.25)
    b = modes(990, [1, 3.93], [1.0, 0.12], [0.12, 0.02], 0.32) + transient(0.32, 1500, 5000, 0.0012, 0.25)
    return finish(place(0.4, [(0, a), (0.075, b)]))


def mk_del():
    # coup sourd qui descend (205 → 154 Hz) sur un bruit de contact grave
    d = 0.17
    lp = signal.butter(2, 1200, 'lowpass', fs=SR, output='sos')
    tr = signal.sosfilt(lp, rng.standard_normal(int(d * SR)) * np.exp(-t_axis(d) / 0.003)) * 0.5
    return finish(tr + modes(205, [1, 2.3], [1, 0.2], [0.042, 0.015], d, glide=0.75), lp=3000)


def mk_err():
    # « toc toc » mat et grave, le second un peu plus bas
    a = modes(290, [1, 2.756], [1, 0.25], [0.03, 0.01], 0.1) + transient(0.1, 600, 3000, 0.0015, 0.2)
    b = modes(258, [1, 2.756], [0.9, 0.22], [0.034, 0.01], 0.12) + transient(0.12, 600, 3000, 0.0015, 0.18)
    return finish(place(0.24, [(0, a), (0.095, b)]), lp=3500)


def mk_toast():
    d = 0.55
    bell = modes(1240, [1, 1.003, 2.32, 4.25], [0.7, 0.3, 0.22, 0.07], [0.22, 0.2, 0.09, 0.04], d)
    return finish(bell + transient(d, 2000, 7000, 0.0008, 0.12), attack=0.003)


def short_rms_db(x):
    y = signal.sosfilt(signal.butter(2, 150, 'highpass', fs=SR, output='sos'), x)
    w = int(0.025 * SR)
    if len(y) < w:
        y = np.pad(y, (0, w - len(y)))
    return 10 * np.log10(max(np.convolve(y * y, np.ones(w) / w, mode='valid').max(), 1e-12))


def normalize(x, target_db):
    y = x * 10 ** ((target_db - short_rms_db(x)) / 20)
    pk = np.abs(y).max()
    return y * (0.89 / pk) if pk > 0.89 else y


def encode(x, path):
    tmp = path[:-4] + '.wav'
    wavfile.write(tmp, SR, x.astype(np.float32))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-ac', '1',
                    '-c:a', 'libmp3lame', '-b:a', '128k', path], check=True)
    os.remove(tmp)


if __name__ == '__main__':
    # L'ordre d'appel fixe la suite aléatoire : ne pas le changer sans regénérer les trois fichiers
    kit = {'click': mk_click(), 'hover': mk_hover(), 'next': mk_next(), 'open': mk_open(),
           'close': mk_close(), 'add': mk_add(), 'done': mk_done(), 'del': mk_del(),
           'err': mk_err(), 'toast': mk_toast()}
    if len(sys.argv) == 3 and sys.argv[1] == '--all':
        os.makedirs(sys.argv[2], exist_ok=True)
        names, out = list(kit), sys.argv[2]
    else:
        names, out = USED, os.path.join(ROOT, 'sounds')
    for name in names:
        encode(normalize(kit[name], TARGET[name]), os.path.join(out, name + '.mp3'))
        print(os.path.join(out, name + '.mp3'))
