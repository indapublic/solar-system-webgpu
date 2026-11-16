# Атрибуция и лицензии

Код проекта распространяется по лицензии **MIT** (см. `LICENSE`). Сторонние данные,
текстуры и производные наборы данных распространяются по своим лицензиям, перечисленным ниже.

## Текстуры планет и колец

Источник: [Solar System Scope](https://www.solarsystemscope.com/textures/) — текстуры
собраны из открытых данных NASA/JPL/USGS (Blue Marble, MOLA, снимки Cassini и Voyager).

Лицензия: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

Файлы в `assets/`:

- `2k_sun.jpg`, `2k_mercury.jpg`, `2k_venus_atmosphere.jpg`, `2k_venus_surface.jpg`,
  `2k_earth_daymap.jpg`, `2k_earth_nightmap.jpg`, `2k_earth_clouds.jpg`, `2k_mars.jpg`,
  `2k_jupiter.jpg`, `2k_saturn.jpg`, `2k_uranus.jpg`, `2k_neptune.jpg`, `2k_moon.jpg`;
- `saturn_rings.png` — радиальный профиль колец Сатурна.

Изменения: файлы используются как текстуры без изменения содержимого; в `wall.html` те же
файлы встроены в HTML как `data:`URL. В сцене к ним применяются освещение, мипы и
постобработка — это производный визуальный результат, а не изменённые исходные файлы.

## Панорама Млечного Пути

`assets/milkyway_4k.jpg` — [ESO/S. Brunier, «The Milky Way panorama»](https://www.eso.org/public/images/eso0932a/).

Лицензия: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Изменения: панорама используется как equirectangular-текстура неба без изменения
содержимого.

## Каталог звёзд и созвездий

Источник: [d3-celestial](https://github.com/ofrohn/d3-celestial) (Olaf Frohn), данные
Hipparcos / Yale Bright Star Catalog.

Лицензия d3-celestial — BSD 3-Clause:

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Изменения: из каталога отобраны звёзды до 3.5ᵐ, координаты RA/Dec переведены в
эклиптическую и мировую системы, линии и имена 89 созвездий выгружены в компактный формат
`tools/stars.mjs` и вшиты в `index.html`. Это производный набор данных, распространяемый
на условиях той же лицензии BSD 3-Clause.

## Элементы орбит и малые тела

- Элементы орбит планет: NASA/JPL Solar System Dynamics, «Keplerian Elements for Approximate
  Positions of the Major Planets» (E. M. Standish):
  <https://ssd.jpl.nasa.gov/planets/approx_pos.html>.
- Элементы комет, астероидов, карликовых планет и межзвёздных объектов:
  [JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html).

Данные NASA/JPL являются открытыми и не охраняются авторским правом. NASA/JPL не
спонсирует и не одобряет этот проект.

## Скриншоты

`docs/screenshot.jpg` и `docs/og.jpg` — рендеры этого проекта. На них видны текстуры
Solar System Scope и панорама ESO/S. Brunier, поэтому при переиспользовании сохраняется
атрибуция выше.

## Идеи

- [Star Nest](https://www.shadertoy.com/view/XlfGRj) (MIT) — принцип объёмного звёздного поля.
- [Singularity](https://www.shadertoy.com/view/3csSWB) — идея линзирования чёрной дыры.
- [PBR](https://www.shadertoy.com/view/wsBBWD) — референс GGX.

Код этих шейдеров в проект не копировался.
