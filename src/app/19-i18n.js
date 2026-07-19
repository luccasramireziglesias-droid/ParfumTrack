

  // ====== i18n (Ciclo 3 Omega) ======
  // Base de internacionalización de bajo riesgo: el español es el idioma
  // fuente (las claves SON los textos en español). t() traduce si hay un
  // diccionario para el idioma activo, y si no, devuelve el texto tal cual.
  // Para sumar un idioma (ej. pt-BR) alcanza con completar _i18n.pt — sin
  // tocar ningún call site: toast() y appConfirm() ya pasan por t().

  _lang: 'es',

  _i18n: {
    // Semilla pt-BR (parcial): demuestra el mecanismo. Completar para el
    // lanzamiento en Brasil. Lo que falte cae al español automáticamente.
    pt: {
      'Venta guardada': 'Venda salva',
      'Perfume agregado': 'Perfume adicionado',
      'Perfume actualizado': 'Perfume atualizado',
      'Perfume eliminado del stock': 'Perfume removido do estoque',
      'Gasto registrado': 'Despesa registrada',
      'Gasto eliminado': 'Despesa excluída',
      'Cuota pagada completa': 'Parcela paga por completo',
      'Pago parcial registrado': 'Pagamento parcial registrado',
      'Foto actualizada': 'Foto atualizada',
      'Datos exportados': 'Dados exportados',
      'Backup descargado': 'Backup baixado',
      'Elegí un perfume': 'Escolha um perfume',
      'Ingresá el precio de venta': 'Informe o preço de venda',
      'Ingresá el nombre': 'Informe o nome',
      'Ingresá un monto': 'Informe um valor',
      'Volver a hoy': 'Voltar para hoje',
      'Eliminar': 'Excluir',
      'Cancelar': 'Cancelar',
      'Guardar': 'Salvar'
    }
  },

  _initLang() {
    const saved = localStorage.getItem('pt_lang');
    if (saved && (saved === 'es' || this._i18n[saved])) {
      this._lang = saved;
    } else {
      // Auto-detección por el idioma del dispositivo (pt → portugués)
      const nav = (navigator.language || 'es').toLowerCase();
      if (nav.startsWith('pt') && this._i18n.pt) this._lang = 'pt';
    }
  },

  setLang(lang) {
    if (lang !== 'es' && !this._i18n[lang]) return;
    this._lang = lang;
    localStorage.setItem('pt_lang', lang);
    if (this.renderAll) this.renderAll();
  },

  // Traduce una clave (texto en español). Soporta interpolación: t('Hola {n}', {n:'Ana'})
  t(str, vars) {
    if (str == null) return str;
    let out = (this._lang !== 'es' && this._i18n[this._lang] && this._i18n[this._lang][str]) || str;
    if (vars) {
      for (const k in vars) out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    }
    return out;
  },
