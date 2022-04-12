import { inject, injectable } from 'tsyringe';
import { Ama, AmaQuestion, AmaUser, kSQL, Settings } from '@ama/common';
import { Component } from '../Component';
import { Rest } from '@cordis/rest';
import { ControlFlowError, decrypt, getQuestionEmbed, QuestionState, send } from '../util';
import { nanoid } from 'nanoid';
import {
  InteractionResponseType,
  APIGuildInteraction,
  APIButtonComponent,
  APIMessageComponentInteraction,
  APIMessageComponentInteractionData,
  ButtonStyle,
  ComponentType,
  RESTPostAPIChannelMessageJSONBody,
  Routes
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';

@injectable()
export default class implements Component {
  public constructor(
    @inject(kSQL) public readonly sql: Sql<{}>,
    public readonly rest: Rest
  ) {}

  public async exec(interaction: APIGuildInteraction) {
    void send(interaction, {}, InteractionResponseType.DeferredMessageUpdate);

    const questionId = (interaction.data as APIMessageComponentInteractionData).custom_id.split('|').pop()!;

    const [data] = await this.sql<[Settings & Ama & AmaQuestion & AmaUser]>`
      SELECT * FROM ama_questions

      INNER JOIN ama_users
      ON ama_users.user_id = ama_questions.author_id

      INNER JOIN amas
      ON amas.id = ama_questions.ama_id

      INNER JOIN settings
      ON settings.guild_id = ${interaction.guild_id}

      WHERE question_id = ${questionId}
    `;

    if (data.ended) {
      throw new ControlFlowError('This AMA has already ended');
    }

    for (const key of ['username', 'discriminator', 'content'] as const) {
      data[key] = decrypt(data[key]);
    }

    const [approve, deny, flag] = (interaction as unknown as APIMessageComponentInteraction)
      .message
      .components![0]!
      .components as [APIButtonComponent, APIButtonComponent, APIButtonComponent];

    approve.style = ButtonStyle.Primary;
    deny.style = ButtonStyle.Secondary;
    flag.style = ButtonStyle.Secondary;

    void send(interaction, {
      embed: getQuestionEmbed(data, QuestionState.approved),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [approve, deny, flag]
        }
      ]
    }, InteractionResponseType.UpdateMessage);

    const id = nanoid();

    void this.rest.post<unknown, RESTPostAPIChannelMessageJSONBody>(
      Routes.channelMessages(data.guest_queue!), {
        data: {
          allowed_mentions: { parse: [] },
          embed: getQuestionEmbed(data),
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Stage',
                  emoji: { name: 'channelstage', id: '829073837538410556', animated: false },
                  style: ButtonStyle.Success,
                  custom_id: `approve_guest|${id}|${data.question_id}|stage`
                },
                {
                  type: ComponentType.Button,
                  label: 'Text',
                  style: ButtonStyle.Success,
                  custom_id: `approve_guest|${id}|${data.question_id}|text`
                },
                {
                  type: ComponentType.Button,
                  label: 'Skip',
                  style: ButtonStyle.Danger,
                  custom_id: `deny_guest|${id}|${data.question_id}`
                }
              ]
            }
          ]
        }
      }
    );
  }
}
