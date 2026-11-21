// 在这里填写 GitHub 账号与姓名，例如 'github-login': '真实姓名'。
const authorName = (() => {
  const names = {
    'Yank000': '严科',
    'tju-yxq': '喻新强',
    'Wzhogqag': '魏忠强',
    'hoyoueee': '廖文强',
  };
  const byLogin = new Map(Object.entries(names).map(([login, name]) => [login.toLowerCase(), name.trim()]));
  return login => byLogin.get(login.toLowerCase()) || login;
})();
