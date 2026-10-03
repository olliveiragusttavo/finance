/** Uma categoria sugerida e as subcategorias que vêm com ela. */
export interface SuggestedCategory {
    readonly name: string;
    readonly subCategories: readonly string[];
}

/**
 * Categorias criadas no primeiro uso, a lista do mockup `DesktopCadastros`. Existem porque
 * toda transação precisa de uma subcategoria (database-design §4.13): um perfil recém-criado
 * sem nenhuma não consegue lançar nada, e o primeiro uso terminaria num formulário que não
 * salva. São só sugestões — o usuário renomeia ou exclui à vontade.
 */
export const SUGGESTED_CATEGORIES: readonly SuggestedCategory[] = [
    { name: 'Moradia', subCategories: ['Aluguel', 'Condomínio', 'Energia'] },
    { name: 'Alimentação', subCategories: ['Mercado', 'Restaurantes', 'Delivery'] },
    { name: 'Transporte', subCategories: ['Combustível', 'App de transporte'] },
    { name: 'Assinaturas', subCategories: ['Streaming', 'Software'] },
    { name: 'Compras', subCategories: ['Eletrônicos', 'Vestuário'] },
    { name: 'Saúde', subCategories: ['Farmácia', 'Plano'] },
    { name: 'Renda', subCategories: ['Salário', 'Freelance'] },
    { name: 'Investimentos', subCategories: ['Aporte'] },
];
