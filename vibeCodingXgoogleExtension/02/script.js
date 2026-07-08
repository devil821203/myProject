const keyMap = {
  a: {
    id: "element-a",
    name: "A 鍵 → 紅色元素"
  },
  s: {
    id: "element-s",
    name: "S 鍵 → 橘色元素"
  },
  d: {
    id: "element-d",
    name: "D 鍵 → 黃色元素"
  },
  f: {
    id: "element-f",
    name: "F 鍵 → 綠色元素"
  },
  g: {
    id: "element-g",
    name: "G 鍵 → 藍色元素"
  }
};

const statusText = document.getElementById("status");

document.addEventListener("keydown", function (event) {
  const key = event.key.toLowerCase();

  if (!keyMap[key]) {
    statusText.textContent = "請按 A、S、D、F、G";
    return;
  }

  const target = document.getElementById(keyMap[key].id);

  target.classList.add("active");
  statusText.textContent = `你按下了 ${keyMap[key].name}`;
});

document.addEventListener("keyup", function (event) {
  const key = event.key.toLowerCase();

  if (!keyMap[key]) {
    return;
  }

  const target = document.getElementById(keyMap[key].id);
  target.classList.remove("active");

  statusText.textContent = "請按下 A、S、D、F、G 任一鍵";
});