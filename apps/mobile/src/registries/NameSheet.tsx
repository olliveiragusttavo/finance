import { readNameForm, reportRejection } from '@finance/client';
import { useState, type ReactNode } from 'react';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { TextField } from '../ui/TextField.tsx';

/**
 * Folha de um cadastro que é só um nome (categoria, subcategoria, tag), como o diálogo de nome
 * do desktop. Valida pelo `readNameForm` do `client` — o campo das rotas — antes de chamar o
 * núcleo; o nome repetido no perfil volta como `CONFLICT` apontando o campo e aparece abaixo dele.
 *
 * @param props.title Título da folha.
 * @param props.description Frase sob o título.
 * @param props.label Rótulo do campo.
 * @param props.fieldLabel Nome do campo com artigo, para a frase do campo vazio.
 * @param props.initial Nome atual, na edição; vazio ao criar.
 * @param props.submitLabel Texto do botão.
 * @param props.pending Se o núcleo ainda está gravando.
 * @param props.onSave Grava o nome; rejeita com a recusa do núcleo.
 * @param props.onClose Fecha a folha.
 * @return A folha.
 */
export function NameSheet(props: {
    readonly title: string;
    readonly description: string;
    readonly label: string;
    readonly fieldLabel: string;
    readonly initial: string;
    readonly submitLabel: string;
    readonly pending: boolean;
    readonly onSave: (name: string) => Promise<unknown>;
    readonly onClose: () => void;
}): ReactNode {
    const { title, description, label, fieldLabel, initial, submitLabel, pending, onSave, onClose } = props;
    const [name, setName] = useState(initial);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [generalError, setGeneralError] = useState<string | null>(null);

    /** Valida o nome com o mesmo campo das rotas e só então chama o núcleo. */
    const submit = (): void => {
        const read = readNameForm(name, fieldLabel);
        if (!read.ok) {
            setFieldError(read.error);
            return;
        }
        setFieldError(null);
        setGeneralError(null);
        onSave(read.name).then(onClose, (rejection: unknown) => {
            reportRejection(
                rejection,
                { name: 'name' },
                (_field, message) => {
                    setFieldError(message);
                },
                setGeneralError,
            );
        });
    };

    return (
        <Sheet open title={title} onClose={onClose}>
            <AppText className="text-13 text-ink2">{description}</AppText>
            <TextField label={label} error={fieldError} value={name} onChangeText={setName} onSubmitEditing={submit} returnKeyType="done" />
            {generalError !== null && (
                <AppText accessibilityRole="alert" className="text-13 text-danger">
                    {generalError}
                </AppText>
            )}
            <Button label={submitLabel} busy={pending} onPress={submit} />
        </Sheet>
    );
}
