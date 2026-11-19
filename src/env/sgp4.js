/**
 * SGP4 / SDP4: the propagator two-line element sets are made for (#91). A JavaScript port of the reference
 * implementation by David A. Vallado, Paul Crawford, Richard Hujsak and T. S. Kelso, "Revisiting Spacetrack Report #3",
 * AIAA 2006-6753 (C++ version of 2021), https://celestrak.org/publications/AIAA/2006-6753/ . The reference code has
 * no license ("you may use it for any purpose") and asks for this citation and the link.
 *
 * The functions below dpper … sgp4 were translated mechanically from the reference (every internal function takes
 * one object of its parameters and returns its by-reference ones), so that they can be compared line by line with it;
 * getgravconst, gstime and the TLE reading are written by hand. Verified against the reference's 33 verification
 * TLEs and its published results (tests/sgp4.test.js). Units as in the reference: km, km/s, minutes since the TLE
 * epoch; the output frame is TEME (true equator, mean equinox of date).
 * Pure functions.
 */
/* eslint-disable */
const pi = Math.PI;
const fmod = (a, b) => a % b; // C fmod: the sign of the dividend, as JS %

/** Greenwich mean sidereal time (rad) at UT1 Julian date jdut1, as the reference computes it. */
export function gstime_SGP4(jdut1) {
  const twopi = 2.0 * pi, deg2rad = pi / 180.0;
  const tut1 = (jdut1 - 2451545.0) / 36525.0;
  let temp = -6.2e-6 * tut1 * tut1 * tut1 + 0.093104 * tut1 * tut1 + (876600.0 * 3600 + 8640184.812866) * tut1 + 67310.54841;
  temp = fmod(temp * deg2rad / 240.0, twopi);
  if (temp < 0.0) temp += twopi;
  return temp;
}

/** The gravity constants of 'wgs72old', 'wgs72' (the one TLEs are made with) or 'wgs84', into record s. */
function getgravconst(whichconst, s) {
  if (whichconst === 'wgs72old') { s.mus = 398600.79964; s.radiusearthkm = 6378.135; s.xke = 0.0743669161; s.j2 = 0.001082616; s.j3 = -0.00000253881; s.j4 = -0.00000165597; }
  else if (whichconst === 'wgs72') { s.mus = 398600.8; s.radiusearthkm = 6378.135; s.xke = 60.0 / Math.sqrt(s.radiusearthkm * s.radiusearthkm * s.radiusearthkm / s.mus); s.j2 = 0.001082616; s.j3 = -0.00000253881; s.j4 = -0.00000165597; }
  else if (whichconst === 'wgs84') { s.mus = 398600.5; s.radiusearthkm = 6378.137; s.xke = 60.0 / Math.sqrt(s.radiusearthkm * s.radiusearthkm * s.radiusearthkm / s.mus); s.j2 = 0.00108262998905; s.j3 = -0.00000253215306; s.j4 = -0.00000161098761; }
  else throw new Error('unknown gravity option ' + whichconst);
  s.tumin = 1.0 / s.xke; s.j3oj2 = s.j3 / s.j2;
}

function dpper(io) {
  let { e3, ee2, peo, pgho, pho, pinco, plo, se2, se3, sgh2, sgh3, sgh4, sh2, sh3, si2, si3, sl2, sl3, sl4, t, xgh2, xgh3, xgh4, xh2, xh3, xi2, xi3, xl2, xl3, xl4, zmol, zmos, inclo, init, ep, inclp, nodep, argpp, mp, opsmode } = io;
const twopi = 2.0 * pi;
let alfdp, betdp, cosip, cosop, dalf, dbet, dls, f2, f3, pe, pgh, ph, pinc, pl, sel, ses, sghl, sghs, shll, shs, sil, sinip, sinop, sinzf, sis, sll, sls, xls, xnoh, zf, zm, zel, zes, znl, zns;
    zns = 1.19459e-5;
    zes = 0.01675;
    znl = 1.5835218e-4;
    zel = 0.05490;
    zm = zmos + zns * t;
    if (init == 'y')
      zm = zmos;
    zf = zm + 2.0 * zes * Math.sin(zm);
    sinzf = Math.sin(zf);
    f2 = 0.5 * sinzf * sinzf - 0.25;
    f3 = -0.5 * sinzf * Math.cos(zf);
    ses = se2* f2 + se3 * f3;
    sis = si2 * f2 + si3 * f3;
    sls = sl2 * f2 + sl3 * f3 + sl4 * sinzf;
    sghs = sgh2 * f2 + sgh3 * f3 + sgh4 * sinzf;
    shs = sh2 * f2 + sh3 * f3;
    zm = zmol + znl * t;
    if (init == 'y')
      zm = zmol;
    zf = zm + 2.0 * zel * Math.sin(zm);
    sinzf = Math.sin(zf);
    f2 = 0.5 * sinzf * sinzf - 0.25;
    f3 = -0.5 * sinzf * Math.cos(zf);
    sel = ee2 * f2 + e3 * f3;
    sil = xi2 * f2 + xi3 * f3;
    sll = xl2 * f2 + xl3 * f3 + xl4 * sinzf;
    sghl = xgh2 * f2 + xgh3 * f3 + xgh4 * sinzf;
    shll = xh2 * f2 + xh3 * f3;
    pe = ses + sel;
    pinc = sis + sil;
    pl = sls + sll;
    pgh = sghs + sghl;
    ph = shs + shll;
    if (init == 'n')
    {
      pe = pe - peo;
      pinc = pinc - pinco;
      pl = pl - plo;
      pgh = pgh - pgho;
      ph = ph - pho;
      inclp = inclp + pinc;
      ep = ep + pe;
      sinip = Math.sin(inclp);
      cosip = Math.cos(inclp);
      if (inclp >= 0.2)
      {
        ph = ph / sinip;
        pgh = pgh - cosip * ph;
        argpp = argpp + pgh;
        nodep = nodep + ph;
        mp = mp + pl;
      }
      else
      {
        sinop = Math.sin(nodep);
        cosop = Math.cos(nodep);
        alfdp = sinip * sinop;
        betdp = sinip * cosop;
        dalf = ph * cosop + pinc * cosip * sinop;
        dbet = -ph * sinop + pinc * cosip * cosop;
        alfdp = alfdp + dalf;
        betdp = betdp + dbet;
        nodep = fmod(nodep, twopi);
        if ((nodep < 0.0) && (opsmode == 'a'))
          nodep = nodep + twopi;
        xls = mp + argpp + cosip * nodep;
        dls = pl + pgh - pinc * nodep * sinip;
        xls = xls + dls;
        xnoh = nodep;
        nodep = Math.atan2(alfdp, betdp);
        if ((nodep < 0.0) && (opsmode == 'a'))
          nodep = nodep + twopi;
        if (Math.abs(xnoh - nodep) > pi)
          if (nodep < xnoh)
            nodep = nodep + twopi;
          else
            nodep = nodep - twopi;
        mp = mp + pl;
        argpp = xls - mp - cosip * nodep;
      }
    }
  return { ep, inclp, nodep, argpp, mp };
}

function dscom(io) {
  let { epoch, ep, argpp, tc, inclp, nodep, np, snodm, cnodm, sinim, cosim, sinomm, cosomm, day, e3, ee2, em, emsq, gam, peo, pgho, pho, pinco, plo, rtemsq, se2, se3, sgh2, sgh3, sgh4, sh2, sh3, si2, si3, sl2, sl3, sl4, s1, s2, s3, s4, s5, s6, s7, ss1, ss2, ss3, ss4, ss5, ss6, ss7, sz1, sz2, sz3, sz11, sz12, sz13, sz21, sz22, sz23, sz31, sz32, sz33, xgh2, xgh3, xgh4, xh2, xh3, xi2, xi3, xl2, xl3, xl4, nm, z1, z2, z3, z11, z12, z13, z21, z22, z23, z31, z32, z33, zmol, zmos } = io;
const zes = 0.01675;
const zel = 0.05490;
const c1ss = 2.9864797e-6;
const c1l = 4.7968065e-7;
const zsinis = 0.39785416;
const zcosis = 0.91744867;
const zcosgs = 0.1945905;
const zsings = -0.98088458;
const twopi = 2.0 * pi;
let lsflg;
let a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, betasq, cc, ctem, stem, x1, x2, x3, x4, x5, x6, x7, x8, xnodce, xnoi, zcosg, zcosgl, zcosh, zcoshl, zcosi, zcosil, zsing, zsingl, zsinh, zsinhl, zsini, zsinil, zx, zy;
    nm = np;
    em = ep;
    snodm = Math.sin(nodep);
    cnodm = Math.cos(nodep);
    sinomm = Math.sin(argpp);
    cosomm = Math.cos(argpp);
    sinim = Math.sin(inclp);
    cosim = Math.cos(inclp);
    emsq = em * em;
    betasq = 1.0 - emsq;
    rtemsq = Math.sqrt(betasq);
    peo = 0.0;
    pinco = 0.0;
    plo = 0.0;
    pgho = 0.0;
    pho = 0.0;
    day = epoch + 18261.5 + tc / 1440.0;
    xnodce = fmod(4.5236020 - 9.2422029e-4 * day, twopi);
    stem = Math.sin(xnodce);
    ctem = Math.cos(xnodce);
    zcosil = 0.91375164 - 0.03568096 * ctem;
    zsinil = Math.sqrt(1.0 - zcosil * zcosil);
    zsinhl = 0.089683511 * stem / zsinil;
    zcoshl = Math.sqrt(1.0 - zsinhl * zsinhl);
    gam = 5.8351514 + 0.0019443680 * day;
    zx = 0.39785416 * stem / zsinil;
    zy = zcoshl * ctem + 0.91744867 * zsinhl * stem;
    zx = Math.atan2(zx, zy);
    zx = gam + zx - xnodce;
    zcosgl = Math.cos(zx);
    zsingl = Math.sin(zx);
    zcosg = zcosgs;
    zsing = zsings;
    zcosi = zcosis;
    zsini = zsinis;
    zcosh = cnodm;
    zsinh = snodm;
    cc = c1ss;
    xnoi = 1.0 / nm;
    for (lsflg = 1; lsflg <= 2; lsflg++)
    {
      a1 = zcosg * zcosh + zsing * zcosi * zsinh;
      a3 = -zsing * zcosh + zcosg * zcosi * zsinh;
      a7 = -zcosg * zsinh + zsing * zcosi * zcosh;
      a8 = zsing * zsini;
      a9 = zsing * zsinh + zcosg * zcosi * zcosh;
      a10 = zcosg * zsini;
      a2 = cosim * a7 + sinim * a8;
      a4 = cosim * a9 + sinim * a10;
      a5 = -sinim * a7 + cosim * a8;
      a6 = -sinim * a9 + cosim * a10;
      x1 = a1 * cosomm + a2 * sinomm;
      x2 = a3 * cosomm + a4 * sinomm;
      x3 = -a1 * sinomm + a2 * cosomm;
      x4 = -a3 * sinomm + a4 * cosomm;
      x5 = a5 * sinomm;
      x6 = a6 * sinomm;
      x7 = a5 * cosomm;
      x8 = a6 * cosomm;
      z31 = 12.0 * x1 * x1 - 3.0 * x3 * x3;
      z32 = 24.0 * x1 * x2 - 6.0 * x3 * x4;
      z33 = 12.0 * x2 * x2 - 3.0 * x4 * x4;
      z1 = 3.0 *  (a1 * a1 + a2 * a2) + z31 * emsq;
      z2 = 6.0 *  (a1 * a3 + a2 * a4) + z32 * emsq;
      z3 = 3.0 *  (a3 * a3 + a4 * a4) + z33 * emsq;
      z11 = -6.0 * a1 * a5 + emsq *  (-24.0 * x1 * x7 - 6.0 * x3 * x5);
      z12 = -6.0 *  (a1 * a6 + a3 * a5) + emsq *
        (-24.0 * (x2 * x7 + x1 * x8) - 6.0 * (x3 * x6 + x4 * x5));
      z13 = -6.0 * a3 * a6 + emsq * (-24.0 * x2 * x8 - 6.0 * x4 * x6);
      z21 = 6.0 * a2 * a5 + emsq * (24.0 * x1 * x5 - 6.0 * x3 * x7);
      z22 = 6.0 *  (a4 * a5 + a2 * a6) + emsq *
        (24.0 * (x2 * x5 + x1 * x6) - 6.0 * (x4 * x7 + x3 * x8));
      z23 = 6.0 * a4 * a6 + emsq * (24.0 * x2 * x6 - 6.0 * x4 * x8);
      z1 = z1 + z1 + betasq * z31;
      z2 = z2 + z2 + betasq * z32;
      z3 = z3 + z3 + betasq * z33;
      s3 = cc * xnoi;
      s2 = -0.5 * s3 / rtemsq;
      s4 = s3 * rtemsq;
      s1 = -15.0 * em * s4;
      s5 = x1 * x3 + x2 * x4;
      s6 = x2 * x3 + x1 * x4;
      s7 = x2 * x4 - x1 * x3;
      if (lsflg == 1)
      {
        ss1 = s1;
        ss2 = s2;
        ss3 = s3;
        ss4 = s4;
        ss5 = s5;
        ss6 = s6;
        ss7 = s7;
        sz1 = z1;
        sz2 = z2;
        sz3 = z3;
        sz11 = z11;
        sz12 = z12;
        sz13 = z13;
        sz21 = z21;
        sz22 = z22;
        sz23 = z23;
        sz31 = z31;
        sz32 = z32;
        sz33 = z33;
        zcosg = zcosgl;
        zsing = zsingl;
        zcosi = zcosil;
        zsini = zsinil;
        zcosh = zcoshl * cnodm + zsinhl * snodm;
        zsinh = snodm * zcoshl - cnodm * zsinhl;
        cc = c1l;
      }
    }
    zmol = fmod(4.7199672 + 0.22997150  * day - gam, twopi);
    zmos = fmod(6.2565837 + 0.017201977 * day, twopi);
    se2 = 2.0 * ss1 * ss6;
    se3 = 2.0 * ss1 * ss7;
    si2 = 2.0 * ss2 * sz12;
    si3 = 2.0 * ss2 * (sz13 - sz11);
    sl2 = -2.0 * ss3 * sz2;
    sl3 = -2.0 * ss3 * (sz3 - sz1);
    sl4 = -2.0 * ss3 * (-21.0 - 9.0 * emsq) * zes;
    sgh2 = 2.0 * ss4 * sz32;
    sgh3 = 2.0 * ss4 * (sz33 - sz31);
    sgh4 = -18.0 * ss4 * zes;
    sh2 = -2.0 * ss2 * sz22;
    sh3 = -2.0 * ss2 * (sz23 - sz21);
    ee2 = 2.0 * s1 * s6;
    e3 = 2.0 * s1 * s7;
    xi2 = 2.0 * s2 * z12;
    xi3 = 2.0 * s2 * (z13 - z11);
    xl2 = -2.0 * s3 * z2;
    xl3 = -2.0 * s3 * (z3 - z1);
    xl4 = -2.0 * s3 * (-21.0 - 9.0 * emsq) * zel;
    xgh2 = 2.0 * s4 * z32;
    xgh3 = 2.0 * s4 * (z33 - z31);
    xgh4 = -18.0 * s4 * zel;
    xh2 = -2.0 * s2 * z22;
    xh3 = -2.0 * s2 * (z23 - z21);
  return { snodm, cnodm, sinim, cosim, sinomm, cosomm, day, e3, ee2, em, emsq, gam, peo, pgho, pho, pinco, plo, rtemsq, se2, se3, sgh2, sgh3, sgh4, sh2, sh3, si2, si3, sl2, sl3, sl4, s1, s2, s3, s4, s5, s6, s7, ss1, ss2, ss3, ss4, ss5, ss6, ss7, sz1, sz2, sz3, sz11, sz12, sz13, sz21, sz22, sz23, sz31, sz32, sz33, xgh2, xgh3, xgh4, xh2, xh3, xi2, xi3, xl2, xl3, xl4, nm, z1, z2, z3, z11, z12, z13, z21, z22, z23, z31, z32, z33, zmol, zmos };
}

function dsinit(io) {
  let { xke, cosim, emsq, argpo, s1, s2, s3, s4, s5, sinim, ss1, ss2, ss3, ss4, ss5, sz1, sz3, sz11, sz13, sz21, sz23, sz31, sz33, t, tc, gsto, mo, mdot, no, nodeo, nodedot, xpidot, z1, z3, z11, z13, z21, z23, z31, z33, ecco, eccsq, em, argpm, inclm, mm, nm, nodem, irez, atime, d2201, d2211, d3210, d3222, d4410, d4422, d5220, d5232, d5421, d5433, dedt, didt, dmdt, dndt, dnodt, domdt, del1, del2, del3, xfact, xlamo, xli, xni } = io;
const twopi = 2.0 * pi;
let ainv2, aonv = 0.0, cosisq, eoc, f220, f221, f311, f321, f322, f330, f441, f442, f522, f523, f542, f543, g200, g201, g211, g300, g310, g322, g410, g422, g520, g521, g532, g533, ses, sgs, sghl, sghs, shs, shll, sis, sini2, sls, temp, temp1, theta, xno2, q22, q31, q33, root22, root44, root54, rptim, root32, root52, x2o3, znl, emo, zns, emsqo;
    q22 = 1.7891679e-6;
    q31 = 2.1460748e-6;
    q33 = 2.2123015e-7;
    root22 = 1.7891679e-6;
    root44 = 7.3636953e-9;
    root54 = 2.1765803e-9;
    rptim = 4.37526908801129966e-3;
    root32 = 3.7393792e-7;
    root52 = 1.1428639e-7;
    x2o3 = 2.0 / 3.0;
    znl = 1.5835218e-4;
    zns = 1.19459e-5;
    irez = 0;
    if ((nm < 0.0052359877) && (nm > 0.0034906585))
      irez = 1;
    if ((nm >= 8.26e-3) && (nm <= 9.24e-3) && (em >= 0.5))
      irez = 2;
    ses = ss1 * zns * ss5;
    sis = ss2 * zns * (sz11 + sz13);
    sls = -zns * ss3 * (sz1 + sz3 - 14.0 - 6.0 * emsq);
    sghs = ss4 * zns * (sz31 + sz33 - 6.0);
    shs = -zns * ss2 * (sz21 + sz23);
    if ((inclm < 5.2359877e-2) || (inclm > pi - 5.2359877e-2))
      shs = 0.0;
    if (sinim != 0.0)
      shs = shs / sinim;
    sgs = sghs - cosim * shs;
    dedt = ses + s1 * znl * s5;
    didt = sis + s2 * znl * (z11 + z13);
    dmdt = sls - znl * s3 * (z1 + z3 - 14.0 - 6.0 * emsq);
    sghl = s4 * znl * (z31 + z33 - 6.0);
    shll = -znl * s2 * (z21 + z23);
    if ((inclm < 5.2359877e-2) || (inclm > pi - 5.2359877e-2))
      shll = 0.0;
    domdt = sgs + sghl;
    dnodt = shs;
    if (sinim != 0.0)
    {
      domdt = domdt - cosim / sinim * shll;
      dnodt = dnodt + shll / sinim;
    }
    dndt = 0.0;
    theta = fmod(gsto + tc * rptim, twopi);
    em = em + dedt * t;
    inclm = inclm + didt * t;
    argpm = argpm + domdt * t;
    nodem = nodem + dnodt * t;
    mm = mm + dmdt * t;
    if (irez != 0)
    {
      aonv = Math.pow(nm / xke, x2o3);
      if (irez == 2)
      {
        cosisq = cosim * cosim;
        emo = em;
        em = ecco;
        emsqo = emsq;
        emsq = eccsq;
        eoc = em * emsq;
        g201 = -0.306 - (em - 0.64) * 0.440;
        if (em <= 0.65)
        {
          g211 = 3.616 - 13.2470 * em + 16.2900 * emsq;
          g310 = -19.302 + 117.3900 * em - 228.4190 * emsq + 156.5910 * eoc;
          g322 = -18.9068 + 109.7927 * em - 214.6334 * emsq + 146.5816 * eoc;
          g410 = -41.122 + 242.6940 * em - 471.0940 * emsq + 313.9530 * eoc;
          g422 = -146.407 + 841.8800 * em - 1629.014 * emsq + 1083.4350 * eoc;
          g520 = -532.114 + 3017.977 * em - 5740.032 * emsq + 3708.2760 * eoc;
        }
        else
        {
          g211 = -72.099 + 331.819 * em - 508.738 * emsq + 266.724 * eoc;
          g310 = -346.844 + 1582.851 * em - 2415.925 * emsq + 1246.113 * eoc;
          g322 = -342.585 + 1554.908 * em - 2366.899 * emsq + 1215.972 * eoc;
          g410 = -1052.797 + 4758.686 * em - 7193.992 * emsq + 3651.957 * eoc;
          g422 = -3581.690 + 16178.110 * em - 24462.770 * emsq + 12422.520 * eoc;
          if (em > 0.715)
            g520 = -5149.66 + 29936.92 * em - 54087.36 * emsq + 31324.56 * eoc;
          else
            g520 = 1464.74 - 4664.75 * em + 3763.64 * emsq;
        }
        if (em < 0.7)
        {
          g533 = -919.22770 + 4988.6100 * em - 9064.7700 * emsq + 5542.21  * eoc;
          g521 = -822.71072 + 4568.6173 * em - 8491.4146 * emsq + 5337.524 * eoc;
          g532 = -853.66600 + 4690.2500 * em - 8624.7700 * emsq + 5341.4  * eoc;
        }
        else
        {
          g533 = -37995.780 + 161616.52 * em - 229838.20 * emsq + 109377.94 * eoc;
          g521 = -51752.104 + 218913.95 * em - 309468.16 * emsq + 146349.42 * eoc;
          g532 = -40023.880 + 170470.89 * em - 242699.48 * emsq + 115605.82 * eoc;
        }
        sini2 = sinim * sinim;
        f220 = 0.75 * (1.0 + 2.0 * cosim + cosisq);
        f221 = 1.5 * sini2;
        f321 = 1.875 * sinim  *  (1.0 - 2.0 * cosim - 3.0 * cosisq);
        f322 = -1.875 * sinim  *  (1.0 + 2.0 * cosim - 3.0 * cosisq);
        f441 = 35.0 * sini2 * f220;
        f442 = 39.3750 * sini2 * sini2;
        f522 = 9.84375 * sinim * (sini2 * (1.0 - 2.0 * cosim - 5.0 * cosisq) +
          0.33333333 * (-2.0 + 4.0 * cosim + 6.0 * cosisq));
        f523 = sinim * (4.92187512 * sini2 * (-2.0 - 4.0 * cosim +
          10.0 * cosisq) + 6.56250012 * (1.0 + 2.0 * cosim - 3.0 * cosisq));
        f542 = 29.53125 * sinim * (2.0 - 8.0 * cosim + cosisq *
          (-12.0 + 8.0 * cosim + 10.0 * cosisq));
        f543 = 29.53125 * sinim * (-2.0 - 8.0 * cosim + cosisq *
          (12.0 + 8.0 * cosim - 10.0 * cosisq));
        xno2 = nm * nm;
        ainv2 = aonv * aonv;
        temp1 = 3.0 * xno2 * ainv2;
        temp = temp1 * root22;
        d2201 = temp * f220 * g201;
        d2211 = temp * f221 * g211;
        temp1 = temp1 * aonv;
        temp = temp1 * root32;
        d3210 = temp * f321 * g310;
        d3222 = temp * f322 * g322;
        temp1 = temp1 * aonv;
        temp = 2.0 * temp1 * root44;
        d4410 = temp * f441 * g410;
        d4422 = temp * f442 * g422;
        temp1 = temp1 * aonv;
        temp = temp1 * root52;
        d5220 = temp * f522 * g520;
        d5232 = temp * f523 * g532;
        temp = 2.0 * temp1 * root54;
        d5421 = temp * f542 * g521;
        d5433 = temp * f543 * g533;
        xlamo = fmod(mo + nodeo + nodeo - theta - theta, twopi);
        xfact = mdot + dmdt + 2.0 * (nodedot + dnodt - rptim) - no;
        em = emo;
        emsq = emsqo;
      }
      if (irez == 1)
      {
        g200 = 1.0 + emsq * (-2.5 + 0.8125 * emsq);
        g310 = 1.0 + 2.0 * emsq;
        g300 = 1.0 + emsq * (-6.0 + 6.60937 * emsq);
        f220 = 0.75 * (1.0 + cosim) * (1.0 + cosim);
        f311 = 0.9375 * sinim * sinim * (1.0 + 3.0 * cosim) - 0.75 * (1.0 + cosim);
        f330 = 1.0 + cosim;
        f330 = 1.875 * f330 * f330 * f330;
        del1 = 3.0 * nm * nm * aonv * aonv;
        del2 = 2.0 * del1 * f220 * g200 * q22;
        del3 = 3.0 * del1 * f330 * g300 * q33 * aonv;
        del1 = del1 * f311 * g310 * q31 * aonv;
        xlamo = fmod(mo + nodeo + argpo - theta, twopi);
        xfact = mdot + xpidot - rptim + dmdt + domdt + dnodt - no;
      }
      xli = xlamo;
      xni = no;
      atime = 0.0;
      nm = no + dndt;
    }
  return { em, argpm, inclm, mm, nm, nodem, irez, atime, d2201, d2211, d3210, d3222, d4410, d4422, d5220, d5232, d5421, d5433, dedt, didt, dmdt, dndt, dnodt, domdt, del1, del2, del3, xfact, xlamo, xli, xni };
}

function dspace(io) {
  let { irez, d2201, d2211, d3210, d3222, d4410, d4422, d5220, d5232, d5421, d5433, dedt, del1, del2, del3, didt, dmdt, dnodt, domdt, argpo, argpdot, t, tc, gsto, xfact, xlamo, no, atime, em, argpm, inclm, xli, mm, xni, nodem, dndt, nm } = io;
const twopi = 2.0 * pi;
let iretn, iret;
let delt, ft, theta, x2li, x2omi, xl, xldot, xnddt, xndt, xomi, g22, g32, g44, g52, g54, fasx2, fasx4, fasx6, rptim, step2, stepn, stepp;
    fasx2 = 0.13130908;
    fasx4 = 2.8843198;
    fasx6 = 0.37448087;
    g22 = 5.7686396;
    g32 = 0.95240898;
    g44 = 1.8014998;
    g52 = 1.0508330;
    g54 = 4.4108898;
    rptim = 4.37526908801129966e-3;
    stepp = 720.0;
    stepn = -720.0;
    step2 = 259200.0;
    dndt = 0.0;
    theta = fmod(gsto + tc * rptim, twopi);
    em = em + dedt * t;
    inclm = inclm + didt * t;
    argpm = argpm + domdt * t;
    nodem = nodem + dnodt * t;
    mm = mm + dmdt * t;
    ft = 0.0;
    if (irez != 0)
    {
      if ((atime == 0.0) || (t * atime <= 0.0) || (Math.abs(t) < Math.abs(atime)))
      {
        atime = 0.0;
        xni = no;
        xli = xlamo;
      }
      if (t > 0.0)
        delt = stepp;
      else
        delt = stepn;
      iretn = 381;
      iret = 0;
      while (iretn == 381)
      {
        if (irez != 2)
        {
          xndt = del1 * Math.sin(xli - fasx2) + del2 * Math.sin(2.0 * (xli - fasx4)) +
            del3 * Math.sin(3.0 * (xli - fasx6));
          xldot = xni + xfact;
          xnddt = del1 * Math.cos(xli - fasx2) +
            2.0 * del2 * Math.cos(2.0 * (xli - fasx4)) +
            3.0 * del3 * Math.cos(3.0 * (xli - fasx6));
          xnddt = xnddt * xldot;
        }
        else
        {
          xomi = argpo + argpdot * atime;
          x2omi = xomi + xomi;
          x2li = xli + xli;
          xndt = d2201 * Math.sin(x2omi + xli - g22) + d2211 * Math.sin(xli - g22) +
            d3210 * Math.sin(xomi + xli - g32) + d3222 * Math.sin(-xomi + xli - g32) +
            d4410 * Math.sin(x2omi + x2li - g44) + d4422 * Math.sin(x2li - g44) +
            d5220 * Math.sin(xomi + xli - g52) + d5232 * Math.sin(-xomi + xli - g52) +
            d5421 * Math.sin(xomi + x2li - g54) + d5433 * Math.sin(-xomi + x2li - g54);
          xldot = xni + xfact;
          xnddt = d2201 * Math.cos(x2omi + xli - g22) + d2211 * Math.cos(xli - g22) +
            d3210 * Math.cos(xomi + xli - g32) + d3222 * Math.cos(-xomi + xli - g32) +
            d5220 * Math.cos(xomi + xli - g52) + d5232 * Math.cos(-xomi + xli - g52) +
            2.0 * (d4410 * Math.cos(x2omi + x2li - g44) +
            d4422 * Math.cos(x2li - g44) + d5421 * Math.cos(xomi + x2li - g54) +
            d5433 * Math.cos(-xomi + x2li - g54));
          xnddt = xnddt * xldot;
        }
        if (Math.abs(t - atime) >= stepp)
        {
          iret = 0;
          iretn = 381;
        }
        else
        {
          ft = t - atime;
          iretn = 0;
        }
        if (iretn == 381)
        {
          xli = xli + xldot * delt + xndt * step2;
          xni = xni + xndt * delt + xnddt * step2;
          atime = atime + delt;
        }
      }
      nm = xni + xndt * ft + xnddt * ft * ft * 0.5;
      xl = xli + xldot * ft + xndt * ft * ft * 0.5;
      if (irez != 1)
      {
        mm = xl - 2.0 * nodem + 2.0 * theta;
        dndt = nm - no;
      }
      else
      {
        mm = xl - nodem - argpm + theta;
        dndt = nm - no;
      }
      nm = no + dndt;
    }
  return { atime, em, argpm, inclm, xli, mm, xni, nodem, dndt, nm };
}

function initl(io) {
  let { xke, j2, ecco, epoch, inclo, no_kozai, opsmode, method, ainv, ao, con41, con42, cosio, cosio2, eccsq, omeosq, posq, rp, rteosq, sinio, gsto, no_unkozai } = io;
let ak, d1, del, adel, po, x2o3;
let ds70;
let ts70, tfrac, c1, thgr70, fk5r, c1p2p;
const twopi = 2.0 * pi;
    x2o3 = 2.0 / 3.0;
    eccsq = ecco * ecco;
    omeosq = 1.0 - eccsq;
    rteosq = Math.sqrt(omeosq);
    cosio = Math.cos(inclo);
    cosio2 = cosio * cosio;
    ak = Math.pow(xke / no_kozai, x2o3);
    d1 = 0.75 * j2 * (3.0 * cosio2 - 1.0) / (rteosq * omeosq);
    del = d1 / (ak * ak);
    adel = ak * (1.0 - del * del - del *
      (1.0 / 3.0 + 134.0 * del * del / 81.0));
    del = d1 / (adel * adel);
    no_unkozai = no_kozai / (1.0 + del);
    ao = Math.pow(xke / (no_unkozai), x2o3);
    sinio = Math.sin(inclo);
    po = ao * omeosq;
    con42 = 1.0 - 5.0 * cosio2;
    con41 = -con42 - cosio2 - cosio2;
    ainv = 1.0 / ao;
    posq = po * po;
    rp = ao * (1.0 - ecco);
    method = 'n';
    ts70 = epoch - 7305.0;
    ds70 = Math.floor(ts70 + 1.0e-8);
    tfrac = ts70 - ds70;
    c1 = 1.72027916940703639e-2;
    thgr70 = 1.7321343856509374;
    fk5r = 5.07551419432269442e-15;
    c1p2p = c1 + twopi;
let gsto1 = fmod(thgr70 + c1*ds70 + c1p2p*tfrac + ts70*ts70*fk5r, twopi);
    if (gsto1 < 0.0)
      gsto1 = gsto1 + twopi;
    gsto = gstime_SGP4(epoch + 2433281.5);
  return { method, ainv, ao, con41, con42, cosio, cosio2, eccsq, omeosq, posq, rp, rteosq, sinio, gsto, no_unkozai };
}

export function sgp4init(whichconst, opsmode, satn, epoch, xbstar, xndot, xnddot, xecco, xargpo, xinclo, xmo, xno_kozai, xnodeo, s) {
let ao, ainv, con42, cosio, sinio, cosio2, eccsq, omeosq, posq, rp, rteosq, cnodm, snodm, cosim, sinim, cosomm, sinomm, cc1sq, cc2, cc3, coef, coef1, cosio4, day, dndt, em, emsq, eeta, etasq, gam, argpm, nodem, inclm, mm, nm, perige, pinvsq, psisq, qzms24, rtemsq, s1, s2, s3, s4, s5, s6, s7, sfour, ss1, ss2, ss3, ss4, ss5, ss6, ss7, sz1, sz2, sz3, sz11, sz12, sz13, sz21, sz22, sz23, sz31, sz32, sz33, tc, temp, temp1, temp2, temp3, tsi, xpidot, xhdot1, z1, z2, z3, z11, z12, z13, z21, z22, z23, z31, z32, z33, qzms2t, ss, x2o3, r = [0, 0, 0], v = [0, 0, 0], delmotemp, qzms2ttemp, qzms24temp;
const temp4 = 1.5e-12;
    s.isimp = 0;   s.method = 'n'; s.aycof = 0.0;
    s.con41 = 0.0; s.cc1 = 0.0; s.cc4 = 0.0;
    s.cc5 = 0.0; s.d2 = 0.0; s.d3 = 0.0;
    s.d4 = 0.0; s.delmo = 0.0; s.eta = 0.0;
    s.argpdot = 0.0; s.omgcof = 0.0; s.sinmao = 0.0;
    s.t = 0.0; s.t2cof = 0.0; s.t3cof = 0.0;
    s.t4cof = 0.0; s.t5cof = 0.0; s.x1mth2 = 0.0;
    s.x7thm1 = 0.0; s.mdot = 0.0; s.nodedot = 0.0;
    s.xlcof = 0.0; s.xmcof = 0.0; s.nodecf = 0.0;
    s.irez = 0;   s.d2201 = 0.0; s.d2211 = 0.0;
    s.d3210 = 0.0; s.d3222 = 0.0; s.d4410 = 0.0;
    s.d4422 = 0.0; s.d5220 = 0.0; s.d5232 = 0.0;
    s.d5421 = 0.0; s.d5433 = 0.0; s.dedt = 0.0;
    s.del1 = 0.0; s.del2 = 0.0; s.del3 = 0.0;
    s.didt = 0.0; s.dmdt = 0.0; s.dnodt = 0.0;
    s.domdt = 0.0; s.e3 = 0.0; s.ee2 = 0.0;
    s.peo = 0.0; s.pgho = 0.0; s.pho = 0.0;
    s.pinco = 0.0; s.plo = 0.0; s.se2 = 0.0;
    s.se3 = 0.0; s.sgh2 = 0.0; s.sgh3 = 0.0;
    s.sgh4 = 0.0; s.sh2 = 0.0; s.sh3 = 0.0;
    s.si2 = 0.0; s.si3 = 0.0; s.sl2 = 0.0;
    s.sl3 = 0.0; s.sl4 = 0.0; s.gsto = 0.0;
    s.xfact = 0.0; s.xgh2 = 0.0; s.xgh3 = 0.0;
    s.xgh4 = 0.0; s.xh2 = 0.0; s.xh3 = 0.0;
    s.xi2 = 0.0; s.xi3 = 0.0; s.xl2 = 0.0;
    s.xl3 = 0.0; s.xl4 = 0.0; s.xlamo = 0.0;
    s.zmol = 0.0; s.zmos = 0.0; s.atime = 0.0;
    s.xli = 0.0; s.xni = 0.0;
    getgravconst(whichconst, s);
    s.satnum = satn;
    s.error = 0;
    s.operationmode = opsmode;
    s.bstar = xbstar;
    s.ndot = xndot;
    s.nddot = xnddot;
    s.ecco = xecco;
    s.argpo = xargpo;
    s.inclo = xinclo;
    s.mo = xmo;
    s.no_kozai = xno_kozai;
    s.nodeo = xnodeo;
    s.am = s.em = s.im = s.Om = s.mm = s.nm = 0.0;
    ss = 78.0 / s.radiusearthkm + 1.0;
    qzms2ttemp = (120.0 - 78.0) / s.radiusearthkm;
    qzms2t = qzms2ttemp * qzms2ttemp * qzms2ttemp * qzms2ttemp;
    x2o3 = 2.0 / 3.0;
    s.init = 'y';
    s.t = 0.0;
    ({ method: s.method, ainv: ainv, ao: ao, con41: s.con41, con42: con42, cosio: cosio, cosio2: cosio2, eccsq: eccsq, omeosq: omeosq, posq: posq, rp: rp, rteosq: rteosq, sinio: sinio, gsto: s.gsto, no_unkozai: s.no_unkozai } = initl({ xke: s.xke, j2: s.j2, ecco: s.ecco, epoch: epoch, inclo: s.inclo, no_kozai: s.no_kozai, opsmode: s.operationmode, method: s.method, ainv: ainv, ao: ao, con41: s.con41, con42: con42, cosio: cosio, cosio2: cosio2, eccsq: eccsq, omeosq: omeosq, posq: posq, rp: rp, rteosq: rteosq, sinio: sinio, gsto: s.gsto, no_unkozai: s.no_unkozai }));
    s.a = Math.pow(s.no_unkozai * s.tumin, (-2.0 / 3.0));
    s.alta = s.a * (1.0 + s.ecco) - 1.0;
    s.altp = s.a * (1.0 - s.ecco) - 1.0;
    s.error = 0;
    if ((omeosq >= 0.0) || (s.no_unkozai >= 0.0))
    {
      s.isimp = 0;
      if (rp < (220.0 / s.radiusearthkm + 1.0))
        s.isimp = 1;
      sfour = ss;
      qzms24 = qzms2t;
      perige = (rp - 1.0) * s.radiusearthkm;
      if (perige < 156.0)
      {
        sfour = perige - 78.0;
        if (perige < 98.0)
          sfour = 20.0;
        qzms24temp = (120.0 - sfour) / s.radiusearthkm;
        qzms24 = qzms24temp * qzms24temp * qzms24temp * qzms24temp;
        sfour = sfour / s.radiusearthkm + 1.0;
      }
      pinvsq = 1.0 / posq;
      tsi = 1.0 / (ao - sfour);
      s.eta = ao * s.ecco * tsi;
      etasq = s.eta * s.eta;
      eeta = s.ecco * s.eta;
      psisq = Math.abs(1.0 - etasq);
      coef = qzms24 * Math.pow(tsi, 4.0);
      coef1 = coef / Math.pow(psisq, 3.5);
      cc2 = coef1 * s.no_unkozai * (ao * (1.0 + 1.5 * etasq + eeta *
        (4.0 + etasq)) + 0.375 * s.j2 * tsi / psisq * s.con41 *
        (8.0 + 3.0 * etasq * (8.0 + etasq)));
      s.cc1 = s.bstar * cc2;
      cc3 = 0.0;
      if (s.ecco > 1.0e-4)
        cc3 = -2.0 * coef * tsi * s.j3oj2 * s.no_unkozai * sinio / s.ecco;
      s.x1mth2 = 1.0 - cosio2;
      s.cc4 = 2.0* s.no_unkozai * coef1 * ao * omeosq *
        (s.eta * (2.0 + 0.5 * etasq) + s.ecco *
        (0.5 + 2.0 * etasq) - s.j2 * tsi / (ao * psisq) *
        (-3.0 * s.con41 * (1.0 - 2.0 * eeta + etasq *
        (1.5 - 0.5 * eeta)) + 0.75 * s.x1mth2 *
        (2.0 * etasq - eeta * (1.0 + etasq)) * Math.cos(2.0 * s.argpo)));
      s.cc5 = 2.0 * coef1 * ao * omeosq * (1.0 + 2.75 *
        (etasq + eeta) + eeta * etasq);
      cosio4 = cosio2 * cosio2;
      temp1 = 1.5 * s.j2 * pinvsq * s.no_unkozai;
      temp2 = 0.5 * temp1 * s.j2 * pinvsq;
      temp3 = -0.46875 * s.j4 * pinvsq * pinvsq * s.no_unkozai;
      s.mdot = s.no_unkozai + 0.5 * temp1 * rteosq * s.con41 + 0.0625 *
        temp2 * rteosq * (13.0 - 78.0 * cosio2 + 137.0 * cosio4);
      s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 *
        (7.0 - 114.0 * cosio2 + 395.0 * cosio4) +
        temp3 * (3.0 - 36.0 * cosio2 + 49.0 * cosio4);
      xhdot1 = -temp1 * cosio;
      s.nodedot = xhdot1 + (0.5 * temp2 * (4.0 - 19.0 * cosio2) +
        2.0 * temp3 * (3.0 - 7.0 * cosio2)) * cosio;
      xpidot = s.argpdot + s.nodedot;
      s.omgcof = s.bstar * cc3 * Math.cos(s.argpo);
      s.xmcof = 0.0;
      if (s.ecco > 1.0e-4)
        s.xmcof = -x2o3 * coef * s.bstar / eeta;
      s.nodecf = 3.5 * omeosq * xhdot1 * s.cc1;
      s.t2cof = 1.5 * s.cc1;
      if (Math.abs(cosio + 1.0) > 1.5e-12)
        s.xlcof = -0.25 * s.j3oj2 * sinio * (3.0 + 5.0 * cosio) / (1.0 + cosio);
      else
        s.xlcof = -0.25 * s.j3oj2 * sinio * (3.0 + 5.0 * cosio) / temp4;
      s.aycof = -0.5 * s.j3oj2 * sinio;
      delmotemp = 1.0 + s.eta * Math.cos(s.mo);
      s.delmo = delmotemp * delmotemp * delmotemp;
      s.sinmao = Math.sin(s.mo);
      s.x7thm1 = 7.0 * cosio2 - 1.0;
      if ((2 * pi / s.no_unkozai) >= 225.0)
      {
        s.method = 'd';
        s.isimp = 1;
        tc = 0.0;
        inclm = s.inclo;
        ({ snodm: snodm, cnodm: cnodm, sinim: sinim, cosim: cosim, sinomm: sinomm, cosomm: cosomm, day: day, e3: s.e3, ee2: s.ee2, em: em, emsq: emsq, gam: gam, peo: s.peo, pgho: s.pgho, pho: s.pho, pinco: s.pinco, plo: s.plo, rtemsq: rtemsq, se2: s.se2, se3: s.se3, sgh2: s.sgh2, sgh3: s.sgh3, sgh4: s.sgh4, sh2: s.sh2, sh3: s.sh3, si2: s.si2, si3: s.si3, sl2: s.sl2, sl3: s.sl3, sl4: s.sl4, s1: s1, s2: s2, s3: s3, s4: s4, s5: s5, s6: s6, s7: s7, ss1: ss1, ss2: ss2, ss3: ss3, ss4: ss4, ss5: ss5, ss6: ss6, ss7: ss7, sz1: sz1, sz2: sz2, sz3: sz3, sz11: sz11, sz12: sz12, sz13: sz13, sz21: sz21, sz22: sz22, sz23: sz23, sz31: sz31, sz32: sz32, sz33: sz33, xgh2: s.xgh2, xgh3: s.xgh3, xgh4: s.xgh4, xh2: s.xh2, xh3: s.xh3, xi2: s.xi2, xi3: s.xi3, xl2: s.xl2, xl3: s.xl3, xl4: s.xl4, nm: nm, z1: z1, z2: z2, z3: z3, z11: z11, z12: z12, z13: z13, z21: z21, z22: z22, z23: z23, z31: z31, z32: z32, z33: z33, zmol: s.zmol, zmos: s.zmos } = dscom({ epoch: epoch, ep: s.ecco, argpp: s.argpo, tc: tc, inclp: s.inclo, nodep: s.nodeo, np: s.no_unkozai, snodm: snodm, cnodm: cnodm, sinim: sinim, cosim: cosim, sinomm: sinomm, cosomm: cosomm, day: day, e3: s.e3, ee2: s.ee2, em: em, emsq: emsq, gam: gam, peo: s.peo, pgho: s.pgho, pho: s.pho, pinco: s.pinco, plo: s.plo, rtemsq: rtemsq, se2: s.se2, se3: s.se3, sgh2: s.sgh2, sgh3: s.sgh3, sgh4: s.sgh4, sh2: s.sh2, sh3: s.sh3, si2: s.si2, si3: s.si3, sl2: s.sl2, sl3: s.sl3, sl4: s.sl4, s1: s1, s2: s2, s3: s3, s4: s4, s5: s5, s6: s6, s7: s7, ss1: ss1, ss2: ss2, ss3: ss3, ss4: ss4, ss5: ss5, ss6: ss6, ss7: ss7, sz1: sz1, sz2: sz2, sz3: sz3, sz11: sz11, sz12: sz12, sz13: sz13, sz21: sz21, sz22: sz22, sz23: sz23, sz31: sz31, sz32: sz32, sz33: sz33, xgh2: s.xgh2, xgh3: s.xgh3, xgh4: s.xgh4, xh2: s.xh2, xh3: s.xh3, xi2: s.xi2, xi3: s.xi3, xl2: s.xl2, xl3: s.xl3, xl4: s.xl4, nm: nm, z1: z1, z2: z2, z3: z3, z11: z11, z12: z12, z13: z13, z21: z21, z22: z22, z23: z23, z31: z31, z32: z32, z33: z33, zmol: s.zmol, zmos: s.zmos }));
        ({ ep: s.ecco, inclp: s.inclo, nodep: s.nodeo, argpp: s.argpo, mp: s.mo } = dpper({ e3: s.e3, ee2: s.ee2, peo: s.peo, pgho: s.pgho, pho: s.pho, pinco: s.pinco, plo: s.plo, se2: s.se2, se3: s.se3, sgh2: s.sgh2, sgh3: s.sgh3, sgh4: s.sgh4, sh2: s.sh2, sh3: s.sh3, si2: s.si2, si3: s.si3, sl2: s.sl2, sl3: s.sl3, sl4: s.sl4, t: s.t, xgh2: s.xgh2, xgh3: s.xgh3, xgh4: s.xgh4, xh2: s.xh2, xh3: s.xh3, xi2: s.xi2, xi3: s.xi3, xl2: s.xl2, xl3: s.xl3, xl4: s.xl4, zmol: s.zmol, zmos: s.zmos, inclo: inclm, init: s.init, ep: s.ecco, inclp: s.inclo, nodep: s.nodeo, argpp: s.argpo, mp: s.mo, opsmode: s.operationmode }));
        argpm = 0.0;
        nodem = 0.0;
        mm = 0.0;
        ({ em: em, argpm: argpm, inclm: inclm, mm: mm, nm: nm, nodem: nodem, irez: s.irez, atime: s.atime, d2201: s.d2201, d2211: s.d2211, d3210: s.d3210, d3222: s.d3222, d4410: s.d4410, d4422: s.d4422, d5220: s.d5220, d5232: s.d5232, d5421: s.d5421, d5433: s.d5433, dedt: s.dedt, didt: s.didt, dmdt: s.dmdt, dndt: dndt, dnodt: s.dnodt, domdt: s.domdt, del1: s.del1, del2: s.del2, del3: s.del3, xfact: s.xfact, xlamo: s.xlamo, xli: s.xli, xni: s.xni } = dsinit({ xke: s.xke, cosim: cosim, emsq: emsq, argpo: s.argpo, s1: s1, s2: s2, s3: s3, s4: s4, s5: s5, sinim: sinim, ss1: ss1, ss2: ss2, ss3: ss3, ss4: ss4, ss5: ss5, sz1: sz1, sz3: sz3, sz11: sz11, sz13: sz13, sz21: sz21, sz23: sz23, sz31: sz31, sz33: sz33, t: s.t, tc: tc, gsto: s.gsto, mo: s.mo, mdot: s.mdot, no: s.no_unkozai, nodeo: s.nodeo, nodedot: s.nodedot, xpidot: xpidot, z1: z1, z3: z3, z11: z11, z13: z13, z21: z21, z23: z23, z31: z31, z33: z33, ecco: s.ecco, eccsq: eccsq, em: em, argpm: argpm, inclm: inclm, mm: mm, nm: nm, nodem: nodem, irez: s.irez, atime: s.atime, d2201: s.d2201, d2211: s.d2211, d3210: s.d3210, d3222: s.d3222, d4410: s.d4410, d4422: s.d4422, d5220: s.d5220, d5232: s.d5232, d5421: s.d5421, d5433: s.d5433, dedt: s.dedt, didt: s.didt, dmdt: s.dmdt, dndt: dndt, dnodt: s.dnodt, domdt: s.domdt, del1: s.del1, del2: s.del2, del3: s.del3, xfact: s.xfact, xlamo: s.xlamo, xli: s.xli, xni: s.xni }));
      }
      if (s.isimp != 1)
      {
        cc1sq = s.cc1 * s.cc1;
        s.d2 = 4.0 * ao * tsi * cc1sq;
        temp = s.d2 * tsi * s.cc1 / 3.0;
        s.d3 = (17.0 * ao + sfour) * temp;
        s.d4 = 0.5 * temp * ao * tsi * (221.0 * ao + 31.0 * sfour) *
          s.cc1;
        s.t3cof = s.d2 + 2.0 * cc1sq;
        s.t4cof = 0.25 * (3.0 * s.d3 + s.cc1 *
          (12.0 * s.d2 + 10.0 * cc1sq));
        s.t5cof = 0.2 * (3.0 * s.d4 +
          12.0 * s.cc1 * s.d3 +
          6.0 * s.d2 * s.d2 +
          15.0 * cc1sq * (2.0 * s.d2 + cc1sq));
      }
    }
    sgp4(s, 0.0, r, v);
    s.init = 'n';
    return true;
}

export function sgp4(s, tsince, r, v) {
let am, axnl, aynl, betal, cosim, cnod, cos2u, coseo1, cosi, cosip, cosisq, cossu, cosu, delm, delomg, em, emsq, ecose, el2, eo1, ep, esine, argpm, argpp, argpdf, pl, mrt = 0.0, mvt, rdotl, rl, rvdot, rvdotl, sinim, sin2u, sineo1, sini, sinip, sinsu, sinu, snod, su, t2, t3, t4, tem5, temp, temp1, temp2, tempa, tempe, templ, u, ux, uy, uz, vx, vy, vz, inclm, mm, nm, nodem, xinc, xincp, xl, xlm, mp, xmdf, xmx, xmy, nodedf, xnode, nodep, tc, dndt, twopi, x2o3, vkmpersec, delmtemp;
let ktr;
const temp4 = 1.5e-12;
    twopi = 2.0 * pi;
    x2o3 = 2.0 / 3.0;
    vkmpersec = s.radiusearthkm * s.xke / 60.0;
    s.t = tsince;
    s.error = 0;
    xmdf = s.mo + s.mdot * s.t;
    argpdf = s.argpo + s.argpdot * s.t;
    nodedf = s.nodeo + s.nodedot * s.t;
    argpm = argpdf;
    mm = xmdf;
    t2 = s.t * s.t;
    nodem = nodedf + s.nodecf * t2;
    tempa = 1.0 - s.cc1 * s.t;
    tempe = s.bstar * s.cc4 * s.t;
    templ = s.t2cof * t2;
    if (s.isimp != 1)
    {
      delomg = s.omgcof * s.t;
      delmtemp = 1.0 + s.eta * Math.cos(xmdf);
      delm = s.xmcof *
        (delmtemp * delmtemp * delmtemp -
        s.delmo);
      temp = delomg + delm;
      mm = xmdf + temp;
      argpm = argpdf - temp;
      t3 = t2 * s.t;
      t4 = t3 * s.t;
      tempa = tempa - s.d2 * t2 - s.d3 * t3 -
        s.d4 * t4;
      tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) -
        s.sinmao);
      templ = templ + s.t3cof * t3 + t4 * (s.t4cof +
        s.t * s.t5cof);
    }
    nm = s.no_unkozai;
    em = s.ecco;
    inclm = s.inclo;
    if (s.method == 'd')
    {
      tc = s.t;
      ({ atime: s.atime, em: em, argpm: argpm, inclm: inclm, xli: s.xli, mm: mm, xni: s.xni, nodem: nodem, dndt: dndt, nm: nm } = dspace({ irez: s.irez, d2201: s.d2201, d2211: s.d2211, d3210: s.d3210, d3222: s.d3222, d4410: s.d4410, d4422: s.d4422, d5220: s.d5220, d5232: s.d5232, d5421: s.d5421, d5433: s.d5433, dedt: s.dedt, del1: s.del1, del2: s.del2, del3: s.del3, didt: s.didt, dmdt: s.dmdt, dnodt: s.dnodt, domdt: s.domdt, argpo: s.argpo, argpdot: s.argpdot, t: s.t, tc: tc, gsto: s.gsto, xfact: s.xfact, xlamo: s.xlamo, no: s.no_unkozai, atime: s.atime, em: em, argpm: argpm, inclm: inclm, xli: s.xli, mm: mm, xni: s.xni, nodem: nodem, dndt: dndt, nm: nm }));
    }
    if (nm <= 0.0)
    {
      s.error = 2;
      return false;
    }
    am = Math.pow((s.xke / nm), x2o3) * tempa * tempa;
    nm = s.xke / Math.pow(am, 1.5);
    em = em - tempe;
    if ((em >= 1.0) || (em < -0.001))
    {
      s.error = 1;
      return false;
    }
    if (em < 1.0e-6)
      em = 1.0e-6;
    mm = mm + s.no_unkozai * templ;
    xlm = mm + argpm + nodem;
    emsq = em * em;
    temp = 1.0 - emsq;
    nodem = fmod(nodem, twopi);
    argpm = fmod(argpm, twopi);
    xlm = fmod(xlm, twopi);
    mm = fmod(xlm - argpm - nodem, twopi);
    s.am = am;
    s.em = em;
    s.im = inclm;
    s.Om = nodem;
    s.om = argpm;
    s.mm = mm;
    s.nm = nm;
    sinim = Math.sin(inclm);
    cosim = Math.cos(inclm);
    ep = em;
    xincp = inclm;
    argpp = argpm;
    nodep = nodem;
    mp = mm;
    sinip = sinim;
    cosip = cosim;
    if (s.method == 'd')
    {
      ({ ep: ep, inclp: xincp, nodep: nodep, argpp: argpp, mp: mp } = dpper({ e3: s.e3, ee2: s.ee2, peo: s.peo, pgho: s.pgho, pho: s.pho, pinco: s.pinco, plo: s.plo, se2: s.se2, se3: s.se3, sgh2: s.sgh2, sgh3: s.sgh3, sgh4: s.sgh4, sh2: s.sh2, sh3: s.sh3, si2: s.si2, si3: s.si3, sl2: s.sl2, sl3: s.sl3, sl4: s.sl4, t: s.t, xgh2: s.xgh2, xgh3: s.xgh3, xgh4: s.xgh4, xh2: s.xh2, xh3: s.xh3, xi2: s.xi2, xi3: s.xi3, xl2: s.xl2, xl3: s.xl3, xl4: s.xl4, zmol: s.zmol, zmos: s.zmos, inclo: s.inclo, init: 'n', ep: ep, inclp: xincp, nodep: nodep, argpp: argpp, mp: mp, opsmode: s.operationmode }));
      if (xincp < 0.0)
      {
        xincp = -xincp;
        nodep = nodep + pi;
        argpp = argpp - pi;
      }
      if ((ep < 0.0) || (ep > 1.0))
      {
        s.error = 3;
        return false;
      }
    }
    if (s.method == 'd')
    {
      sinip = Math.sin(xincp);
      cosip = Math.cos(xincp);
      s.aycof = -0.5*s.j3oj2*sinip;
      if (Math.abs(cosip + 1.0) > 1.5e-12)
        s.xlcof = -0.25 * s.j3oj2 * sinip * (3.0 + 5.0 * cosip) / (1.0 + cosip);
      else
        s.xlcof = -0.25 * s.j3oj2 * sinip * (3.0 + 5.0 * cosip) / temp4;
    }
    axnl = ep * Math.cos(argpp);
    temp = 1.0 / (am * (1.0 - ep * ep));
    aynl = ep* Math.sin(argpp) + temp * s.aycof;
    xl = mp + argpp + nodep + temp * s.xlcof * axnl;
    u = fmod(xl - nodep, twopi);
    eo1 = u;
    tem5 = 9999.9;
    ktr = 1;
    while ((Math.abs(tem5) >= 1.0e-12) && (ktr <= 10))
    {
      sineo1 = Math.sin(eo1);
      coseo1 = Math.cos(eo1);
      tem5 = 1.0 - coseo1 * axnl - sineo1 * aynl;
      tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
      if (Math.abs(tem5) >= 0.95)
        tem5 = tem5 > 0.0 ? 0.95 : -0.95;
      eo1 = eo1 + tem5;
      ktr = ktr + 1;
    }
    ecose = axnl*coseo1 + aynl*sineo1;
    esine = axnl*sineo1 - aynl*coseo1;
    el2 = axnl*axnl + aynl*aynl;
    pl = am*(1.0 - el2);
    if (pl < 0.0)
    {
      s.error = 4;
      return false;
    }
    else
    {
      rl = am * (1.0 - ecose);
      rdotl = Math.sqrt(am) * esine / rl;
      rvdotl = Math.sqrt(pl) / rl;
      betal = Math.sqrt(1.0 - el2);
      temp = esine / (1.0 + betal);
      sinu = am / rl * (sineo1 - aynl - axnl * temp);
      cosu = am / rl * (coseo1 - axnl + aynl * temp);
      su = Math.atan2(sinu, cosu);
      sin2u = (cosu + cosu) * sinu;
      cos2u = 1.0 - 2.0 * sinu * sinu;
      temp = 1.0 / pl;
      temp1 = 0.5 * s.j2 * temp;
      temp2 = temp1 * temp;
      if (s.method == 'd')
      {
        cosisq = cosip * cosip;
        s.con41 = 3.0*cosisq - 1.0;
        s.x1mth2 = 1.0 - cosisq;
        s.x7thm1 = 7.0*cosisq - 1.0;
      }
      mrt = rl * (1.0 - 1.5 * temp2 * betal * s.con41) +
        0.5 * temp1 * s.x1mth2 * cos2u;
      su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
      xnode = nodep + 1.5 * temp2 * cosip * sin2u;
      xinc = xincp + 1.5 * temp2 * cosip * sinip * cos2u;
      mvt = rdotl - nm * temp1 * s.x1mth2 * sin2u / s.xke;
      rvdot = rvdotl + nm * temp1 * (s.x1mth2 * cos2u +
        1.5 * s.con41) / s.xke;
      sinsu = Math.sin(su);
      cossu = Math.cos(su);
      snod = Math.sin(xnode);
      cnod = Math.cos(xnode);
      sini = Math.sin(xinc);
      cosi = Math.cos(xinc);
      xmx = -snod * cosi;
      xmy = cnod * cosi;
      ux = xmx * sinsu + cnod * cossu;
      uy = xmy * sinsu + snod * cossu;
      uz = sini * sinsu;
      vx = xmx * cossu - cnod * sinsu;
      vy = xmy * cossu - snod * sinsu;
      vz = sini * cossu;
      r[0] = (mrt * ux)* s.radiusearthkm;
      r[1] = (mrt * uy)* s.radiusearthkm;
      r[2] = (mrt * uz)* s.radiusearthkm;
      v[0] = (mvt * ux + rvdot * vx) * vkmpersec;
      v[1] = (mvt * uy + rvdot * vy) * vkmpersec;
      v[2] = (mvt * uz + rvdot * vz) * vkmpersec;
    }
    if (mrt < 1.0)
    {
      s.error = 6;
      return false;
    }
    return true;
}

/** SGP4 error codes (s.error after sgp4), as the reference sets them. */
export const SGP4_ERRORS = {
  1: 'mean elements out of range (e ≥ 1 or e < −0.001, or a < 0.95 Earth radii)', 2: 'mean motion below zero', 99: 'its output is not a number',
  3: 'the perturbed eccentricity left 0..1', 4: 'the semi-latus rectum went below zero', 6: 'the satellite has decayed (below the Earth\'s surface)',
};

/**
 * An SGP4 record from the two lines of a TLE (the columns of the standard format, as the reference's twoline2rv
 * reads them; the lines are assumed already checked, e.g. by parseTLE). opsmode 'a' (AFSPC) and WGS-72, the
 * settings the reference recommends to match the published element sets.
 */
export function tleSatrec(line1, line2, { opsmode = 'a', whichconst = 'wgs72' } = {}) {
  const num = (s, a, b) => +s.slice(a, b);
  const expo = (s, a, b) => { const t = s.slice(a, b).trim(); if (!t) return 0; const m = t.match(/^([+-]?)(\d+)([+-]\d)$/); return m ? +(m[1] + '0.' + m[2]) * 10 ** +m[3] : +t; };
  const xpdotp = 1440.0 / (2.0 * pi), d2r = pi / 180;
  const yy = num(line1, 18, 20), year = yy < 57 ? yy + 2000 : yy + 1900, epochdays = num(line1, 20, 32);
  // days from 0 h on 1949 December 31 to 0 h on December 31 before the epoch year (jday of year, Jan 0), then the epoch day
  const jdJan0 = 367 * year - Math.floor(7 * (year + Math.floor(10 / 12)) / 4) + Math.floor(275 / 9) + 0 + 1721013.5; // jday(year, 1, 0)
  const epoch = jdJan0 - 2433281.5 + epochdays;
  const ndot = num(line1, 33, 43), nddot = expo(line1, 44, 52), bstar = expo(line1, 53, 61);
  const s = {};
  sgp4init(whichconst, opsmode, line1.slice(2, 7).trim(), epoch, bstar, ndot / (xpdotp * 1440.0), nddot / (xpdotp * 1440.0 * 1440.0),
    num(line2, 26, 33) * 1e-7, num(line2, 34, 42) * d2r, num(line2, 8, 16) * d2r, num(line2, 43, 51) * d2r, num(line2, 52, 63) / xpdotp, num(line2, 17, 25) * d2r, s);
  s.jdsatepoch = jdJan0 + epochdays; // as Julian date (whole and fraction together: enough for display)
  return s;
}

const fine = (s, t, r, v) => sgp4(s, t, r, v) && r.every(Number.isFinite) && v.every(Number.isFinite);
/**
 * Where a TLE with drag (B* ≠ 0) re-enters, in the direction of tsince (minutes; s.stopF ahead, s.stopB back), scanned
 * once as far as asked, in sixteenths of a period, then to 1e-4 min: { to (min scanned), at (min, or null), error }.
 * After such a decay SGP4 can give states again (its drag polynomial turns round, e.g. 5 km up 18 min later), so
 * what lies beyond it counts as decayed. Other stops are per call, as in the reference: without drag a perigee that
 * dips below the surface (lunar–solar terms) can come up again, and the reference's results go on there.
 */
function firstStop(s, tsince) {
  const dir = tsince < 0 ? -1 : 1, key = dir > 0 ? 'stopF' : 'stopB', sc = s[key] || (s[key] = { to: 0, at: null, error: 0 });
  const target = Math.abs(tsince); if (sc.at !== null || target <= sc.to) return sc;
  const step = 2 * pi / s.no_unkozai / 16, r = [0, 0, 0], v = [0, 0, 0], ok = t => fine(s, dir * t, r, v);
  if (!s.bstar) { sc.to = Infinity; return sc; } // no drag: no re-entry to look for
  const reentry = t => !ok(t) && s.error === 6;
  for (let a = sc.to; a < target;) {
    const b = Math.min(target, a + step);
    if (reentry(b)) {
      let lo = a, hi = b; for (let k = 0; k < 60 && hi - lo > 1e-4; k++) { const m = (lo + hi) / 2; if (reentry(m)) hi = m; else lo = m; }
      sc.at = dir * hi; sc.error = 6; sc.to = hi; return sc;
    }
    a = b;
  }
  sc.to = target; return sc;
}

/**
 * Position (km) and velocity (km/s) in TEME, tsince minutes after the TLE epoch; null, with s.error set, where SGP4
 * stops, after a re-entry (firstStop), or if its output isn't finite (error 99).
 */
export function sgp4At(s, tsince) {
  const st = firstStop(s, tsince);
  if (st.at !== null && Math.abs(tsince) >= Math.abs(st.at)) { s.error = st.error; return null; }
  const r = [0, 0, 0], v = [0, 0, 0];
  if (fine(s, tsince, r, v)) return { r, v };
  if (!s.error) s.error = 99; return null;
}
