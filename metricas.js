// 1. Definição dos dados (O objeto que você enviou)
const RESULTADOS = [
  { min: 0, max: 9, cor: 'verde', nivel: 'Uso Saudável' },
  { min: 10, max: 19, cor: 'amarelo', nivel: 'Zona de Atenção' },
  { min: 20, max: 27, cor: 'laranja', nivel: 'Uso Problemático' },
  { min: 28, max: 45, cor: 'vermelho', nivel: 'Dependência Digital' }
];

// 2. Função para enviar os dados à planilha
function enviarDadosParaPlanilha(pontuacao, classificacao) {
    const url = "https://script.google.com/macros/s/AKfycbwGbjxEBG2TWeovd6yOf1yznekEzJysRJgTYNX-IRy_qlDZMNICIGT5oM0aK0gXrfPn/exec"; // Cole aqui a URL gerada no Google

    fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            pontos: pontuacao, 
            cor: classificacao 
        })
    })
    .then(() => console.log("Dados registrados na planilha com sucesso!"))
    .catch(err => console.error("Erro na automação:", err));
}

// 3. Função Principal (A que o seu botão do HTML deve chamar)
function mostrarResultado(pontosObtidos) {
    // Encontra qual objeto dentro de RESULTADOS corresponde aos pontos
    const pontosNumericos = parseInt(pontosObtidos);
    const resultadoFinal = RESULTADOS.find(r => pontosNumericos >= r.min && pontosNumericos <= r.max);

    if (resultadoFinal) {
        // Logica de Automação: Envia para o Google Sheets
        enviarDadosParaPlanilha(pontosObtidos, resultadoFinal.cor);

        // Lógica de Interface: Aqui você usa os dados para mudar o site
        console.log("Nível:", resultadoFinal.nivel);
        console.log("Título:", resultadoFinal.titulo);
        
        // Exemplo: Mudar a cor do fundo ou tocar a música baseada na cor
        aplicarMudancasVisuais(resultadoFinal);
    }
}

// 4. Exemplo de função para mudar o visual (Baseado no seu Objetivo 2)
function aplicarMudancasVisuais(config) {
    // Altera a cor do tema do resultado
    const container = document.getElementById('resultado');
    container.className = `resultado-ativo theme-${config.cor}`;
    
    // Tocar música (exemplo simbólico)
    if(config.cor === 'Vermelho') {
        tocarMusicaAlerta();
    } else {
        tocarMusicaSuave();
    }
}